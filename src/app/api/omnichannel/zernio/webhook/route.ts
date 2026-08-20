import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { resolveAuditUserId } from '@/lib/api/v1/contacts'
import { isUniqueViolation } from '@/lib/contacts/dedupe'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { verifyZernioSignature, type ZernioChannel } from '@/lib/zernio/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

type Json = Record<string, unknown>
type Connector = {
  id: string
  account_id: string
  provider: `zernio_${ZernioChannel}`
  display_name: string
  zernio_account_id: string | null
}

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Falta la configuración del servidor.')
  return createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
}

function text(...values: unknown[]) {
  for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim()
  return ''
}

function record(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}
}

function channelFrom(value: unknown): ZernioChannel | null {
  const normalized = text(value).toLowerCase()
  if (normalized.includes('instagram')) return 'instagram'
  if (normalized.includes('facebook') || normalized.includes('messenger')) return 'facebook'
  if (normalized.includes('whatsapp')) return 'whatsapp'
  return null
}

function entries(payload: Json) {
  if (Array.isArray(payload.events)) return payload.events.map(record)
  if (Array.isArray(payload.data)) return payload.data.map(record)
  return [payload]
}

async function resolveContact(
  db: ReturnType<typeof admin>,
  connector: Connector,
  externalUserId: string,
  auditUserId: string,
  name: string,
) {
  const { data: mapped, error: mapError } = await db
    .from('omnichannel_contact_identities')
    .select('contact_id')
    .eq('connector_id', connector.id)
    .eq('external_user_id', externalUserId)
    .maybeSingle()
  if (mapError) throw mapError
  if (mapped?.contact_id) return mapped.contact_id as string

  const fallback = `Cliente ${connector.provider.replace('zernio_', '')} ${externalUserId.slice(-6)}`
  const phone = `zernio:${connector.provider}:${externalUserId}`
  const { data: existing, error: existingError } = await db
    .from('contacts')
    .select('id')
    .eq('account_id', connector.account_id)
    .eq('phone', phone)
    .maybeSingle()
  if (existingError) throw existingError

  let contactId = existing?.id as string | undefined
  if (!contactId) {
    const { data: created, error } = await db
      .from('contacts')
      .insert({ account_id: connector.account_id, user_id: auditUserId, phone, name: name || fallback })
      .select('id')
      .single()
    if (error || !created) throw error ?? new Error('No se pudo crear el contacto del canal conectado.')
    contactId = created.id
  }

  const { error: identityError } = await db.from('omnichannel_contact_identities').insert({
    account_id: connector.account_id,
    connector_id: connector.id,
    external_user_id: externalUserId,
    contact_id: contactId,
  })
  if (identityError && !isUniqueViolation(identityError)) throw identityError
  if (identityError) {
    const { data: concurrent } = await db
      .from('omnichannel_contact_identities')
      .select('contact_id')
      .eq('connector_id', connector.id)
      .eq('external_user_id', externalUserId)
      .maybeSingle()
    if (concurrent?.contact_id) return concurrent.contact_id as string
  }
  return contactId
}

async function registerReceipt(
  db: ReturnType<typeof admin>,
  connector: Connector,
  eventId: string,
  eventType: string,
  payload: Json,
) {
  const { error } = await db.from('zernio_webhook_receipts').insert({
    account_id: connector.account_id,
    connector_id: connector.id,
    external_message_id: eventId,
    event_type: eventType,
    payload,
  })
  if (!error) return true
  if (isUniqueViolation(error)) return false
  throw error
}

export async function POST(request: Request) {
  const raw = await request.text()
  const signature = request.headers.get('x-zernio-signature') ?? request.headers.get('x-late-signature')
  if (!verifyZernioSignature(raw, signature)) {
    return NextResponse.json({ error: 'Firma de webhook inválida.' }, { status: 401 })
  }

  let payload: Json
  try {
    payload = JSON.parse(raw) as Json
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }

  const db = admin()
  try {
    for (const event of entries(payload)) {
      const eventType = text(event.event, payload.event)
      if (eventType !== 'message.received' && eventType !== 'comment.received') continue

      const message = record(event.message)
      const comment = record(event.comment)
      const incoming = eventType === 'comment.received' ? comment : message
      const conversation = record(event.conversation ?? incoming.conversation)
      const account = record(event.account ?? incoming.account)
      const post = record(event.post)
      const participantSource = conversation.contact ?? conversation.customer ?? conversation.participant
      const participant = record(participantSource)
      const sender = record(incoming.sender ?? event.sender ?? participantSource ?? comment.author)
      const externalUserId = text(sender.id, sender._id, sender.userId, participant.id, participant._id, comment.author_id, comment.authorId, conversation.customerId, conversation.contactId, event.senderId)
      const externalMessageId = text(incoming.id, incoming._id, event.messageId, event.id)
      const externalEventId = text(event.id, request.headers.get('x-zernio-event-id'), externalMessageId)
      const externalConversationId = text(
        conversation.id,
        conversation._id,
        incoming.conversationId,
        event.conversationId,
        eventType === 'comment.received' && externalUserId ? `comment:${text(post.id, post._id, event.postId)}:${externalUserId}` : '',
      )
      const channel = channelFrom(account.platform ?? account.channel ?? account.type ?? event.channel ?? event.platform ?? incoming.channel ?? conversation.channel ?? payload.channel)
      const zernioAccountId = text(account.id, account._id, event.accountId, event.account_id, incoming.accountId, conversation.accountId, payload.accountId)
      if (!externalEventId || !externalConversationId || !externalUserId || !channel || !zernioAccountId) continue

      const { data: connector, error: connectorError } = await db
        .from('omnichannel_connectors')
        .select('id, account_id, provider, display_name, zernio_account_id')
        .eq('provider', `zernio_${channel}`)
        .eq('zernio_account_id', zernioAccountId)
        .neq('status', 'paused')
        .maybeSingle()
      if (connectorError) throw connectorError
      if (!connector) continue
      const typed = connector as Connector
      if (!(await registerReceipt(db, typed, externalEventId, eventType, event))) continue

      const content = text(incoming.text, incoming.content, incoming.body, comment.message, comment.text, event.text) || '[Mensaje sin texto]'
      const auditUserId = await resolveAuditUserId(db, typed.account_id)
      const contactId = await resolveContact(
        db,
        typed,
        externalUserId,
        auditUserId,
        text(sender.name, sender.displayName, sender.fullName, comment.author_name, comment.authorName, participant.name),
      )
      const { data: rows, error: findError } = await db
        .from('conversations')
        .select('id, unread_count')
        .eq('account_id', typed.account_id)
        .eq('connector_id', typed.id)
        .eq('external_session_id', externalConversationId)
        .limit(1)
      if (findError) throw findError

      let conversationRow = rows?.[0]
      let created = false
      if (!conversationRow) {
        const { data, error } = await db
          .from('conversations')
          .insert({ account_id: typed.account_id, user_id: auditUserId, contact_id: contactId, channel_type: typed.provider, connector_id: typed.id, external_session_id: externalConversationId, channel_source_label: typed.display_name })
          .select('id, unread_count')
          .single()
        if (error || !data) throw error ?? new Error('No se pudo crear la conversación entrante.')
        conversationRow = data
        created = true
      }

      const now = new Date().toISOString()
      const messageId = `zernio:${typed.id}:${externalMessageId || externalEventId}`
      const { error: messageError } = await db.from('messages').insert({ conversation_id: conversationRow.id, sender_type: 'customer', content_type: 'text', content_text: content, message_id: messageId, status: 'delivered', created_at: now })
      if (messageError && !isUniqueViolation(messageError)) throw messageError
      await db.from('conversations').update({ status: 'open', last_message_text: content, last_message_at: now, unread_count: (conversationRow.unread_count ?? 0) + 1, updated_at: now }).eq('id', conversationRow.id)
      await db.rpc('auto_assign_inbound_conversation', { p_account_id: typed.account_id, p_conversation_id: conversationRow.id })
      await db.from('omnichannel_connectors').update({ status: 'active', last_event_at: now, last_error: null, updated_at: now }).eq('id', typed.id)
      if (created) await dispatchWebhookEvent(db, typed.account_id, 'conversation.created', { conversation_id: conversationRow.id, contact_id: contactId, channel_type: typed.provider, connector_id: typed.id })
      await dispatchWebhookEvent(db, typed.account_id, 'message.received', { conversation_id: conversationRow.id, contact_id: contactId, message_id: messageId, channel_type: typed.provider, content_type: 'text', text: content })
      await db.from('zernio_webhook_receipts').update({ outcome: 'processed', detail: 'Mensaje del canal conectado agregado.', processed_at: now }).eq('connector_id', typed.id).eq('external_message_id', externalEventId)
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[zernio] webhook failed', error)
    return NextResponse.json({ error: 'No se pudo procesar el evento.' }, { status: 500 })
  }
}
