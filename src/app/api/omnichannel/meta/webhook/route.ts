import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { decrypt } from '@/lib/whatsapp/encryption'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { resolveAuditUserId } from '@/lib/api/v1/contacts'
import { isUniqueViolation } from '@/lib/contacts/dedupe'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

type MetaMessaging = {
  sender?: { id?: string }
  recipient?: { id?: string }
  timestamp?: number
  message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: Array<{ type?: string }> }
}
type MetaEntry = { id?: string; messaging?: MetaMessaging[] }
type MetaPayload = { object?: string; entry?: MetaEntry[] }
type Connector = {
  id: string; account_id: string; provider: 'facebook' | 'instagram'; display_name: string; external_channel_id: string
  meta_access_token: string | null; meta_app_secret: string | null; meta_verify_token: string | null; status: string
}

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase server configuration')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

function eventType(provider: Connector['provider']) { return provider === 'facebook' ? 40001 : 40002 }
function time(value: unknown) {
  const milliseconds = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return new Date().toISOString()
  const date = new Date(milliseconds)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

async function claimReceipt(db: ReturnType<typeof admin>, connector: Connector, externalMessageId: string) {
  const type = eventType(connector.provider)
  const { error } = await db.from('omnichannel_webhook_receipts').insert({
    account_id: connector.account_id, connector_id: connector.id, event_type: type, external_message_id: externalMessageId, outcome: 'processing',
  })
  if (!error) return true
  if (!isUniqueViolation(error)) throw error
  return false
}

async function resolveContact(db: ReturnType<typeof admin>, connector: Connector, externalUserId: string, auditUserId: string) {
  const { data: mapped, error: mapError } = await db.from('omnichannel_contact_identities')
    .select('contact_id').eq('connector_id', connector.id).eq('external_user_id', externalUserId).maybeSingle()
  if (mapError) throw mapError
  if (mapped?.contact_id) return mapped.contact_id as string

  const placeholderPhone = `meta:${connector.provider}:${externalUserId}`
  const { data: contactByPhone, error: phoneError } = await db.from('contacts')
    .select('id').eq('account_id', connector.account_id).eq('phone', placeholderPhone).maybeSingle()
  if (phoneError) throw phoneError
  let contactId = contactByPhone?.id as string | undefined
  if (!contactId) {
    const label = connector.provider === 'facebook' ? 'Cliente Facebook' : 'Cliente Instagram'
    const { data: contact, error: contactError } = await db.from('contacts').insert({
      account_id: connector.account_id, user_id: auditUserId, phone: placeholderPhone, name: `${label} ${externalUserId.slice(-6)}`,
    }).select('id').single()
    if (contactError || !contact) throw contactError ?? new Error('No se pudo crear el contacto de Meta.')
    contactId = contact.id
  }
  const { error: identityError } = await db.from('omnichannel_contact_identities').insert({
    account_id: connector.account_id, connector_id: connector.id, external_user_id: externalUserId, contact_id: contactId,
  })
  if (identityError && !isUniqueViolation(identityError)) throw identityError
  if (identityError) {
    const { data: concurrent } = await db.from('omnichannel_contact_identities').select('contact_id')
      .eq('connector_id', connector.id).eq('external_user_id', externalUserId).maybeSingle()
    if (concurrent?.contact_id) return concurrent.contact_id as string
  }
  return contactId
}

async function ingestMessage(db: ReturnType<typeof admin>, connector: Connector, entry: MetaEntry, event: MetaMessaging) {
  const senderId = event.sender?.id?.trim()
  const messageId = event.message?.mid?.trim()
  if (!senderId || !messageId || event.message?.is_echo || senderId === connector.external_channel_id) return { ignored: true }
  if (!await claimReceipt(db, connector, messageId)) return { duplicate: true }
  const auditUserId = await resolveAuditUserId(db, connector.account_id)
  const contactId = await resolveContact(db, connector, senderId, auditUserId)
  const { data: rows, error: findError } = await db.from('conversations').select('id, unread_count')
    .eq('account_id', connector.account_id).eq('connector_id', connector.id).eq('external_session_id', senderId).limit(1)
  if (findError) throw findError
  let conversation = rows?.[0]
  let created = false
  if (!conversation) {
    const { data, error } = await db.from('conversations').insert({
      account_id: connector.account_id, user_id: auditUserId, contact_id: contactId, channel_type: connector.provider,
      connector_id: connector.id, external_session_id: senderId, channel_source_label: connector.display_name,
    }).select('id, unread_count').single()
    if (error || !data) throw error ?? new Error('No se pudo crear la conversación Meta.')
    conversation = data
    created = true
  }
  const attachment = event.message?.attachments?.[0]
  const contentText = event.message?.text?.trim() || (attachment?.type === 'image' ? '[Imagen enviada desde Meta]' : attachment ? `[Archivo enviado desde ${connector.provider === 'facebook' ? 'Facebook' : 'Instagram'}]` : '[Mensaje sin texto]')
  const createdAt = time(event.timestamp)
  const { error: messageError } = await db.from('messages').insert({
    conversation_id: conversation.id, sender_type: 'customer', content_type: attachment?.type === 'image' ? 'image' : 'text',
    content_text: contentText, message_id: `meta:${connector.id}:${messageId}`, status: 'delivered', created_at: createdAt,
  })
  if (messageError) throw messageError
  const now = new Date().toISOString()
  const { error: updateError } = await db.from('conversations').update({
    status: 'open', last_message_text: contentText, last_message_at: createdAt, unread_count: (conversation.unread_count ?? 0) + 1, updated_at: now,
  }).eq('id', conversation.id)
  if (updateError) throw updateError
  const { error: assignmentError } = await db.rpc('auto_assign_inbound_conversation', { p_account_id: connector.account_id, p_conversation_id: conversation.id })
  if (assignmentError) console.error('[meta] automatic assignment failed:', assignmentError.message)
  if (created) await dispatchWebhookEvent(db, connector.account_id, 'conversation.created', { conversation_id: conversation.id, contact_id: contactId, channel_type: connector.provider, connector_id: connector.id })
  await dispatchWebhookEvent(db, connector.account_id, 'message.received', { conversation_id: conversation.id, contact_id: contactId, message_id: `meta:${connector.id}:${messageId}`, channel_type: connector.provider, content_type: attachment?.type === 'image' ? 'image' : 'text', text: contentText })
  await db.from('omnichannel_webhook_receipts').update({ outcome: 'processed', detail: `Mensaje ${connector.provider} agregado.`, processed_at: now })
    .eq('connector_id', connector.id).eq('event_type', eventType(connector.provider)).eq('external_message_id', messageId)
  return { conversationId: conversation.id }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  if (url.searchParams.get('hub.mode') !== 'subscribe') return new NextResponse('Not found', { status: 404 })
  const verifyToken = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')
  if (!verifyToken || !challenge) return new NextResponse('Forbidden', { status: 403 })
  try {
    const { data, error } = await admin().from('omnichannel_connectors')
      .select('meta_verify_token').in('provider', ['facebook', 'instagram']).not('meta_verify_token', 'is', null)
    if (error) throw error
    const matched = (data ?? []).some((row) => {
      try { return decrypt(row.meta_verify_token as string) === verifyToken } catch { return false }
    })
    return matched
      ? new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
      : new NextResponse('Forbidden', { status: 403 })
  } catch (error) {
    console.error('[meta] verification failed:', error)
    return new NextResponse('Unavailable', { status: 503 })
  }
}

export async function POST(request: Request) {
  const db = admin()
  try {
    const rawBody = await request.text()
    const payload = JSON.parse(rawBody) as MetaPayload
    if (payload.object !== 'page' && payload.object !== 'instagram') return NextResponse.json({ received: true, ignored: true })
    const ids = (payload.entry ?? []).map((entry) => entry.id?.trim()).filter((id): id is string => Boolean(id))
    const { data, error } = await db.from('omnichannel_connectors')
      .select('id, account_id, provider, display_name, external_channel_id, meta_access_token, meta_app_secret, meta_verify_token, status')
      .in('provider', ['facebook', 'instagram']).in('external_channel_id', ids)
    if (error) throw error
    const connectors = (data ?? []) as Connector[]
    const signature = request.headers.get('x-hub-signature-256')
    const signed = connectors.some((connector) => {
      try {
        if (!connector.meta_app_secret) return false
        return verifyMetaWebhookSignature(rawBody, signature, decrypt(connector.meta_app_secret))
      } catch { return false }
    })
    if (!signed) return NextResponse.json({ error: 'Firma de webhook Meta inválida.' }, { status: 401 })
    const byChannel = new Map(connectors.map((connector) => [connector.external_channel_id, connector]))
    let processed = 0
    for (const entry of payload.entry ?? []) {
      const connector = entry.id ? byChannel.get(entry.id) : undefined
      if (!connector || connector.status === 'paused') continue
      for (const event of entry.messaging ?? []) {
        try {
          const result = await ingestMessage(db, connector, entry, event)
          if ('conversationId' in result) processed += 1
        } catch (error) {
          console.error('[meta] could not ingest message:', error)
          const id = event.message?.mid
          if (id) await db.from('omnichannel_webhook_receipts').update({ outcome: 'failed', detail: 'No se pudo procesar el mensaje de Meta.', processed_at: new Date().toISOString() })
            .eq('connector_id', connector.id).eq('event_type', eventType(connector.provider)).eq('external_message_id', id)
        }
      }
      await db.from('omnichannel_connectors').update({ status: 'active', last_event_at: new Date().toISOString(), last_error: null }).eq('id', connector.id)
    }
    return NextResponse.json({ received: true, processed })
  } catch (error) {
    console.error('[meta] webhook processing failed:', error)
    return NextResponse.json({ error: 'No se pudo procesar el webhook Meta.' }, { status: 500 })
  }
}
