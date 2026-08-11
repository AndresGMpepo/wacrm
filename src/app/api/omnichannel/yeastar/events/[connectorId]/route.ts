import crypto from 'node:crypto'

import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { decrypt } from '@/lib/whatsapp/encryption'
import { isUniqueViolation } from '@/lib/contacts/dedupe'
import { resolveAuditUserId } from '@/lib/api/v1/contacts'

export const maxDuration = 10

type YeastarMessage = {
  session_id?: number | string
  msg_id?: number | string
  sender?: { user_no?: string; user_type?: number; username?: string }
  msg_type?: number
  msg_body?: string
  msg_files?: string
  send_time?: number | string
}

type YeastarEvent = { type?: number; event?: string; msg?: YeastarMessage }

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase server configuration')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

function verifySignature(rawBody: string, header: string | null, secret: string) {
  if (!header) return false
  const actual = header.trim().replace(/^sha256=/i, '')
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64')
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer)
}

function messageTimestamp(value: unknown) {
  const seconds = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return new Date().toISOString()
  const date = new Date(seconds * 1000)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function isMediaMessage(files: unknown) {
  if (typeof files !== 'string' || !files.trim()) return false
  try {
    return Array.isArray(JSON.parse(files)) && JSON.parse(files).length > 0
  } catch {
    return false
  }
}

async function claimReceipt(db: ReturnType<typeof admin>, accountId: string, connectorId: string, eventType: number, externalMessageId: string) {
  const payload = { account_id: accountId, connector_id: connectorId, event_type: eventType, external_message_id: externalMessageId, outcome: 'processing' }
  const { error } = await db.from('omnichannel_webhook_receipts').insert(payload)
  if (!error) return true
  if (!isUniqueViolation(error)) throw error

  const { data: previous, error: previousError } = await db.from('omnichannel_webhook_receipts')
    .select('outcome').eq('connector_id', connectorId).eq('event_type', eventType).eq('external_message_id', externalMessageId).maybeSingle()
  if (previousError) throw previousError
  if (previous?.outcome !== 'failed') return false

  const { data: reclaimed, error: reclaimError } = await db.from('omnichannel_webhook_receipts')
    .update({ outcome: 'processing', detail: null, received_at: new Date().toISOString(), processed_at: null })
    .eq('connector_id', connectorId).eq('event_type', eventType).eq('external_message_id', externalMessageId).eq('outcome', 'failed')
    .select('id')
  if (reclaimError) throw reclaimError
  return Boolean(reclaimed?.length)
}

export async function POST(request: Request, { params }: { params: Promise<{ connectorId: string }> }) {
  const { connectorId } = await params
  const db = admin()
  let receipt: { accountId: string; eventType: number; externalMessageId: string } | null = null

  try {
    const rawBody = await request.text()
    const event = JSON.parse(rawBody) as YeastarEvent
    const { data: connector, error: connectorError } = await db.from('omnichannel_connectors')
      .select('id, account_id, provider, display_name, source_url, webhook_secret')
      .eq('id', connectorId).eq('provider', 'yeastar_live_chat').maybeSingle()
    if (connectorError) throw connectorError
    if (!connector?.webhook_secret) return NextResponse.json({ error: 'Webhook no configurado.' }, { status: 404 })

    let webhookSecret: string
    try {
      webhookSecret = decrypt(connector.webhook_secret)
    } catch {
      console.error('[yeastar-live-chat] could not decrypt connector webhook secret')
      return NextResponse.json({ error: 'Webhook no disponible.' }, { status: 503 })
    }
    if (!verifySignature(rawBody, request.headers.get('x-signature'), webhookSecret)) {
      return NextResponse.json({ error: 'Firma de webhook inválida.' }, { status: 401 })
    }

    if (event.event === 'test') {
      await db.from('omnichannel_connectors').update({ status: 'active', last_event_at: new Date().toISOString(), last_error: null }).eq('id', connector.id)
      return NextResponse.json({ received: true, test: true })
    }
    // Yeastar's 30031 report body can omit `type`; the event is already
    // identified by this dedicated, per-connector webhook URL. When the
    // field is present, still reject a different event defensively.
    const eventType = event.type == null ? 30031 : Number(event.type)
    if (eventType !== 30031 || !event.msg) {
      await db.from('omnichannel_connectors').update({ status: 'active', last_event_at: new Date().toISOString(), last_error: null }).eq('id', connector.id)
      return NextResponse.json({ received: true, ignored: true })
    }

    const sessionId = String(event.msg.session_id ?? '').trim()
    const messageId = String(event.msg.msg_id ?? '').trim()
    const externalUserId = event.msg.sender?.user_no?.trim() ?? ''
    const externalMessageId = `${sessionId}:${messageId}`
    if (!sessionId || !messageId || !externalUserId) {
      return NextResponse.json({ error: 'Evento 30031 incompleto.' }, { status: 400 })
    }

    receipt = { accountId: connector.account_id, eventType: 30031, externalMessageId }
    const claimed = await claimReceipt(db, connector.account_id, connector.id, 30031, externalMessageId)
    if (!claimed) return NextResponse.json({ received: true, duplicate: true })

    // Live Chat visitors are user_type 5. Do not accidentally ingest SMS,
    // Facebook or API messages through a connector configured for this source.
    if (Number(event.msg.sender?.user_type) !== 5 || Number(event.msg.msg_type) !== 0) {
      await db.from('omnichannel_webhook_receipts').update({ outcome: 'ignored', detail: 'Evento no corresponde a un mensaje entrante Live Chat.', processed_at: new Date().toISOString() })
        .eq('connector_id', connector.id).eq('event_type', 30031).eq('external_message_id', externalMessageId)
      return NextResponse.json({ received: true, ignored: true })
    }

    const auditUserId = await resolveAuditUserId(db, connector.account_id)
    const visitorName = event.msg.sender?.username?.trim().slice(0, 160) || `Visitante web ${externalUserId.slice(-8)}`
    let contactId: string
    const { data: identity, error: identityError } = await db.from('omnichannel_contact_identities')
      .select('contact_id').eq('connector_id', connector.id).eq('external_user_id', externalUserId).maybeSingle()
    if (identityError) throw identityError
    if (identity) {
      contactId = identity.contact_id
      await db.from('omnichannel_contact_identities').update({ display_name: visitorName }).eq('connector_id', connector.id).eq('external_user_id', externalUserId)
    } else {
      const { data: contact, error: contactError } = await db.from('contacts').insert({
        account_id: connector.account_id,
        user_id: auditUserId,
        // Live Chat has an external visitor ID rather than a phone number.
        // Prefix it so contact phone normalization never collides with WhatsApp.
        phone: `yeastar-chat:${connector.id}:${externalUserId}`,
        name: visitorName,
      }).select('id').single()
      if (contactError || !contact) throw contactError ?? new Error('Could not create Live Chat contact')
      contactId = contact.id
      const { error: identityInsertError } = await db.from('omnichannel_contact_identities').insert({
        account_id: connector.account_id,
        connector_id: connector.id,
        external_user_id: externalUserId,
        contact_id: contactId,
        display_name: visitorName,
      })
      if (identityInsertError) throw identityInsertError
    }

    const { data: conversations, error: conversationError } = await db.from('conversations')
      .select('id, unread_count').eq('account_id', connector.account_id).eq('connector_id', connector.id).eq('external_session_id', sessionId)
      .order('created_at', { ascending: true }).limit(1)
    if (conversationError) throw conversationError
    let conversation = conversations?.[0]
    let conversationCreated = false
    if (!conversation) {
      const { data: created, error: createConversationError } = await db.from('conversations').insert({
        account_id: connector.account_id,
        user_id: auditUserId,
        contact_id: contactId,
        channel_type: 'yeastar_live_chat',
        connector_id: connector.id,
        external_session_id: sessionId,
        channel_source_label: connector.display_name,
        channel_source_url: connector.source_url,
      }).select('id, unread_count').single()
      if (createConversationError || !created) throw createConversationError ?? new Error('Could not create Live Chat conversation')
      conversation = created
      conversationCreated = true
    }

    const contentText = event.msg.msg_body?.trim() || (isMediaMessage(event.msg.msg_files) ? '[Archivo enviado desde Yeastar Live Chat]' : '[Mensaje sin texto]')
    const createdAt = messageTimestamp(event.msg.send_time)
    const { error: messageError } = await db.from('messages').insert({
      conversation_id: conversation.id,
      sender_type: 'customer',
      content_type: isMediaMessage(event.msg.msg_files) ? 'document' : 'text',
      content_text: contentText,
      message_id: `yeastar:${connector.id}:${externalMessageId}`,
      status: 'delivered',
      created_at: createdAt,
    })
    if (messageError) throw messageError

    const now = new Date().toISOString()
    const { error: updateConversationError } = await db.from('conversations').update({
      status: 'open',
      last_message_text: contentText,
      last_message_at: createdAt,
      unread_count: (conversation.unread_count ?? 0) + 1,
      updated_at: now,
    }).eq('id', conversation.id)
    if (updateConversationError) throw updateConversationError

    // Uses the existing account-level routing policy. A failure here must not
    // discard a correctly received customer message.
    const { error: assignmentError } = await db.rpc('auto_assign_inbound_conversation', {
      p_account_id: connector.account_id,
      p_conversation_id: conversation.id,
    })
    if (assignmentError) console.error('[yeastar-live-chat] automatic assignment failed:', assignmentError.message)

    await db.from('omnichannel_webhook_receipts').update({ outcome: 'processed', detail: conversationCreated ? 'Conversación Live Chat creada.' : 'Mensaje Live Chat agregado.', processed_at: now })
      .eq('connector_id', connector.id).eq('event_type', 30031).eq('external_message_id', externalMessageId)
    await db.from('omnichannel_connectors').update({ status: 'active', last_event_at: now, last_error: null }).eq('id', connector.id)

    return NextResponse.json({ received: true, conversationId: conversation.id })
  } catch (error) {
    console.error('[yeastar-live-chat] webhook processing failed:', error)
    if (receipt) {
      await db.from('omnichannel_webhook_receipts').update({ outcome: 'failed', detail: 'No se pudo procesar el evento; Yeastar puede reintentarlo.', processed_at: new Date().toISOString() })
        .eq('connector_id', connectorId).eq('event_type', receipt.eventType).eq('external_message_id', receipt.externalMessageId)
      await db.from('omnichannel_connectors').update({ status: 'error', last_error: 'No se pudo procesar el último evento de Live Chat.' }).eq('id', connectorId)
    }
    return NextResponse.json({ error: 'No se pudo procesar el evento.' }, { status: 500 })
  }
}
