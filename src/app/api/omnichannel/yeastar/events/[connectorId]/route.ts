import crypto from 'node:crypto'

import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { decrypt } from '@/lib/whatsapp/encryption'
import { isUniqueViolation } from '@/lib/contacts/dedupe'
import { resolveAuditUserId } from '@/lib/api/v1/contacts'

// Receiving an image requires a PBX download and a Storage upload before the
// webhook can be acknowledged. Keep this bounded but above the text-only path.
export const maxDuration = 30

type YeastarMessage = {
  session_id?: number | string
  msg_id?: number | string
  sender?: { user_no?: string; user_type?: number; username?: string }
  msg_type?: number
  msg_body?: string
  msg_files?: string
  send_time?: number | string
}

type YeastarFile = { name?: string; uri?: string; type?: string; size?: number | string }
type YeastarTokenReply = { errcode?: number; errmsg?: string; access_token?: string; access_token_expire_time?: number }
type CachedToken = { value: string; expiresAt: number }
const tokenCache = new Map<string, CachedToken>()

type YeastarEvent = { type?: number | string; event?: string; msg?: YeastarMessage | string }

function parseYeastarMessage(value: YeastarEvent['msg']): YeastarMessage | null {
  if (!value) return null
  if (typeof value === 'object') return value
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as YeastarMessage : null
  } catch {
    return null
  }
}

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

function firstMediaFile(files: unknown): YeastarFile | null {
  if (!files) return null
  try {
    const parsed: unknown = typeof files === 'string' ? JSON.parse(files) : files
    if (!Array.isArray(parsed) || !parsed.length || !parsed[0] || typeof parsed[0] !== 'object') return null
    const file = parsed[0] as YeastarFile
    return typeof file.uri === 'string' && file.uri.trim() ? file : null
  } catch {
    return null
  }
}

function apiUrl(pbxUrl: string, endpoint: string) {
  return new URL(`openapi/v1.0/${endpoint}`, `${pbxUrl.replace(/\/+$/, '')}/`)
}

async function accessToken(accountId: string, pbxUrl: string, clientId: string, clientSecret: string) {
  const cacheKey = `${accountId}:${pbxUrl}`
  const cached = tokenCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const response = await fetch(apiUrl(pbxUrl, 'get_token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'OpenAPI' },
    body: JSON.stringify({ username: clientId, password: clientSecret }),
    signal: AbortSignal.timeout(15_000),
  })
  const reply = await response.json().catch(() => ({})) as YeastarTokenReply
  if (!response.ok || reply.errcode !== 0 || !reply.access_token) throw new Error(reply.errmsg || 'Yeastar no aceptó las credenciales OpenAPI.')
  tokenCache.set(cacheKey, { value: reply.access_token, expiresAt: Date.now() + Math.max(60, (reply.access_token_expire_time ?? 1800) - 60) * 1000 })
  return reply.access_token
}

function safeFileName(value: string | undefined) {
  return (value ?? 'imagen').replace(/[^A-Za-z0-9._-]/g, '_').slice(-100) || 'imagen'
}

async function mirrorImageToWacrm(
  db: ReturnType<typeof admin>,
  params: { accountId: string; connectorId: string; pbxUrl: string; clientId: string; clientSecret: string; uri: string; name?: string; expectedType?: string },
) {
  // Yeastar returns a URI relative to /ysdisk/cache/chat. It is intended for
  // file access but not for direct browser rendering from another origin.
  if (!/^[A-Za-z0-9/_-]{1,300}$/.test(params.uri)) throw new Error('Yeastar devolvió una URI de archivo inválida.')
  const token = await accessToken(params.accountId, params.pbxUrl, decrypt(params.clientId), decrypt(params.clientSecret))
  const fileUrl = new URL(`/ysdisk/cache/chat/${params.uri}`, params.pbxUrl)
  fileUrl.searchParams.set('access_token', token)
  const response = await fetch(fileUrl, { headers: { 'User-Agent': 'OpenAPI' }, signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`Yeastar no permitió descargar la imagen (HTTP ${response.status}).`)
  const type = response.headers.get('content-type') ?? params.expectedType ?? ''
  if (!type.toLowerCase().startsWith('image/')) throw new Error('El archivo recibido no es una imagen válida.')
  const bytes = await response.arrayBuffer()
  if (!bytes.byteLength || bytes.byteLength > 16 * 1024 * 1024) throw new Error('La imagen recibida excede el límite de 16 MB de WACRM.')
  const path = `account-${params.accountId}/yeastar-live-chat/${params.connectorId}/${crypto.randomUUID()}-${safeFileName(params.name)}`
  const { error: uploadError } = await db.storage.from('chat-media').upload(path, new Uint8Array(bytes), { contentType: type, upsert: false })
  if (uploadError) throw uploadError
  const { data } = db.storage.from('chat-media').getPublicUrl(path)
  if (!data.publicUrl) throw new Error('No se pudo publicar la imagen recibida.')
  return data.publicUrl
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
      .select('id, account_id, provider, display_name, source_url, webhook_secret, status, outbound_pbx_url, outbound_api_client_id, outbound_api_client_secret')
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

    // Pausar no altera el PBX ni invalida su webhook. Los eventos firmados se
    // aceptan sin crear contactos, mensajes ni conversaciones hasta reactivar.
    if (connector.status === 'paused') {
      return NextResponse.json({ received: true, paused: true }, { status: 202 })
    }

    if (event.event === 'test') {
      await db.from('omnichannel_connectors').update({ status: 'active', last_event_at: new Date().toISOString(), last_error: null }).eq('id', connector.id)
      return NextResponse.json({ received: true, test: true })
    }
    // Yeastar's 30031 report body can omit `type`; the event is already
    // identified by this dedicated, per-connector webhook URL. When the
    // field is present, still reject a different event defensively.
    const eventType = event.type == null ? 30031 : Number(event.type)
    const message = parseYeastarMessage(event.msg)
    if (eventType !== 30031 || !message) {
      await db.from('omnichannel_connectors').update({ status: 'active', last_event_at: new Date().toISOString(), last_error: null }).eq('id', connector.id)
      return NextResponse.json({ received: true, ignored: true })
    }

    const sessionId = String(message.session_id ?? '').trim()
    const messageId = String(message.msg_id ?? '').trim()
    const externalUserId = message.sender?.user_no?.trim() ?? ''
    const externalMessageId = `${sessionId}:${messageId}`
    if (!sessionId || !messageId || !externalUserId) {
      return NextResponse.json({ error: 'Evento 30031 incompleto.' }, { status: 400 })
    }

    receipt = { accountId: connector.account_id, eventType: 30031, externalMessageId }
    const claimed = await claimReceipt(db, connector.account_id, connector.id, 30031, externalMessageId)
    if (!claimed) return NextResponse.json({ received: true, duplicate: true })

    // Live Chat visitors are user_type 5. Do not accidentally ingest SMS,
    // Facebook or API messages through a connector configured for this source.
    if (Number(message.sender?.user_type) !== 5 || Number(message.msg_type) !== 0) {
      await db.from('omnichannel_webhook_receipts').update({ outcome: 'ignored', detail: 'Evento no corresponde a un mensaje entrante Live Chat.', processed_at: new Date().toISOString() })
        .eq('connector_id', connector.id).eq('event_type', 30031).eq('external_message_id', externalMessageId)
      return NextResponse.json({ received: true, ignored: true })
    }

    const auditUserId = await resolveAuditUserId(db, connector.account_id)
    const visitorName = message.sender?.username?.trim().slice(0, 160) || `Visitante web ${externalUserId.slice(-8)}`
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

    const mediaFile = firstMediaFile(message.msg_files)
    const isImage = Boolean(mediaFile?.type?.toLowerCase().startsWith('image/'))
    const contentText = message.msg_body?.trim() || mediaFile?.name || (mediaFile ? '[Archivo enviado desde Yeastar Live Chat]' : '[Mensaje sin texto]')
    let mediaUrl: string | null = null
    let mediaError: string | null = null
    if (isImage && mediaFile?.uri) {
      try {
        let pbxUrl = connector.outbound_pbx_url
        let clientId = connector.outbound_api_client_id
        let clientSecret = connector.outbound_api_client_secret
        if (!pbxUrl || !clientId || !clientSecret) {
          const [monitoringResult, telephonyResult] = await Promise.all([
            db.from('yeastar_monitoring_configs').select('api_client_id, api_client_secret').eq('account_id', connector.account_id).maybeSingle(),
            db.from('telephony_configs').select('pbx_url').eq('account_id', connector.account_id).eq('provider', 'yeastar').maybeSingle(),
          ])
          if (monitoringResult.error) throw monitoringResult.error
          if (telephonyResult.error) throw telephonyResult.error
          pbxUrl = pbxUrl ?? telephonyResult.data?.pbx_url ?? null
          clientId = clientId ?? monitoringResult.data?.api_client_id ?? null
          clientSecret = clientSecret ?? monitoringResult.data?.api_client_secret ?? null
        }
        if (!pbxUrl || !clientId || !clientSecret) throw new Error('Faltan URL o credenciales OpenAPI para descargar la imagen.')
        mediaUrl = await mirrorImageToWacrm(db, {
          accountId: connector.account_id,
          connectorId: connector.id,
          pbxUrl,
          clientId,
          clientSecret,
          uri: mediaFile.uri,
          name: mediaFile.name,
          expectedType: mediaFile.type,
        })
      } catch (error) {
        mediaError = error instanceof Error ? error.message : 'No se pudo descargar la imagen desde Yeastar.'
        console.error('[yeastar-live-chat] could not mirror inbound image:', mediaError)
      }
    }
    const createdAt = messageTimestamp(message.send_time)
    const { error: messageError } = await db.from('messages').insert({
      conversation_id: conversation.id,
      sender_type: 'customer',
      content_type: mediaFile ? (isImage ? 'image' : 'document') : 'text',
      content_text: contentText,
      media_url: mediaUrl,
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

    await db.from('omnichannel_webhook_receipts').update({ outcome: 'processed', detail: mediaError ?? (conversationCreated ? 'Conversación Live Chat creada.' : 'Mensaje Live Chat agregado.'), processed_at: now })
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
