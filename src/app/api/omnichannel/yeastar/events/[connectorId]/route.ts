import crypto from 'node:crypto'

import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { decrypt } from '@/lib/whatsapp/encryption'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { resolveAuditUserId } from '@/lib/api/v1/contacts'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'

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
type YeastarPreChatForm = { name?: string; first_name?: string; last_name?: string; email?: string; phone?: string }
type YeastarSessionReply = YeastarTokenReply & { list?: { pre_chat_form?: YeastarPreChatForm } }
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

// Live Chat media uses a public widget route, while the pre-chat form is read
// through Yeastar OpenAPI with a short-lived token.
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

function field(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().replace(/\s+/g, ' ')
  return normalized && normalized.length <= maxLength ? normalized : null
}

function preChatName(form: YeastarPreChatForm | null) {
  const explicit = field(form?.name, 160)
  if (explicit) return explicit
  return [field(form?.first_name, 80), field(form?.last_name, 80)].filter(Boolean).join(' ') || null
}

async function getPreChatForm(
  db: ReturnType<typeof admin>,
  connector: { account_id: string; outbound_pbx_url: string | null; outbound_api_client_id: string | null; outbound_api_client_secret: string | null },
  sessionId: string,
) {
  const sessionNumber = Number(sessionId)
  if (!Number.isSafeInteger(sessionNumber) || sessionNumber <= 0) return null

  // Per-channel credentials take precedence. The global monitoring
  // connection remains a backwards-compatible fallback for older channels.
  const [monitoringResult, telephonyResult] = await Promise.all([
    db.from('yeastar_monitoring_configs').select('api_client_id, api_client_secret').eq('account_id', connector.account_id).maybeSingle(),
    db.from('telephony_configs').select('pbx_url').eq('account_id', connector.account_id).eq('provider', 'yeastar').maybeSingle(),
  ])
  if (monitoringResult.error) throw monitoringResult.error
  if (telephonyResult.error) throw telephonyResult.error

  const pbxUrl = connector.outbound_pbx_url ?? telephonyResult.data?.pbx_url
  const encryptedClientId = connector.outbound_api_client_id ?? monitoringResult.data?.api_client_id
  const encryptedClientSecret = connector.outbound_api_client_secret ?? monitoringResult.data?.api_client_secret
  if (!pbxUrl || !encryptedClientId || !encryptedClientSecret) return null

  const token = await accessToken(
    connector.account_id,
    pbxUrl,
    decrypt(encryptedClientId),
    decrypt(encryptedClientSecret),
  )
  const sessionUrl = apiUrl(pbxUrl, 'message_session/get')
  sessionUrl.searchParams.set('access_token', token)
  sessionUrl.searchParams.set('id', String(sessionNumber))
  const response = await fetch(sessionUrl, { headers: { 'User-Agent': 'OpenAPI' }, signal: AbortSignal.timeout(12_000) })
  const result = await response.json().catch(() => ({})) as YeastarSessionReply
  if (!response.ok || result.errcode !== 0) throw new Error(result.errmsg || 'Yeastar no devolvió la sesión del chat.')
  return result.list?.pre_chat_form ?? null
}

async function resolveLiveChatContact(
  db: ReturnType<typeof admin>,
  params: { accountId: string; auditUserId: string; connectorId: string; externalUserId: string; visitorName: string; preChat: YeastarPreChatForm | null },
) {
  const { data: identity, error: identityError } = await db.from('omnichannel_contact_identities')
    .select('contact_id').eq('connector_id', params.connectorId).eq('external_user_id', params.externalUserId).maybeSingle()
  if (identityError) throw identityError

  const name = preChatName(params.preChat) ?? params.visitorName
  const emailValue = field(params.preChat?.email, 254)?.toLowerCase() ?? null
  const phoneValue = field(params.preChat?.phone, 80)

  if (identity) {
    await db.from('omnichannel_contact_identities').update({ display_name: name }).eq('connector_id', params.connectorId).eq('external_user_id', params.externalUserId)
    return identity.contact_id as string
  }

  // Phone is the strongest identity and wins if phone/email point at different
  // contacts. We never silently merge two customer records in a webhook.
  const phoneMatch = phoneValue ? await findExistingContact(db, params.accountId, phoneValue) : null
  let emailMatch: { id: string; name: string | null; email: string | null; phone: string } | null = null
  if (!phoneMatch && emailValue) {
    const { data, error } = await db.from('contacts')
      .select('id, name, email, phone').eq('account_id', params.accountId).ilike('email', emailValue).limit(1)
    if (error) throw error
    emailMatch = data?.[0] ?? null
  }

  const existing = phoneMatch ?? emailMatch
  let contactId: string
  if (existing) {
    contactId = existing.id
    const existingPhone = String(existing.phone ?? '')
    const existingName = typeof existing.name === 'string' ? existing.name.trim() : ''
    const existingEmail = typeof existing.email === 'string' ? existing.email.trim().toLowerCase() : ''
    const update: Record<string, string> = {}
    if (name && (!existingName || existingName.startsWith('Visitante web '))) update.name = name
    if (emailValue && !existingEmail) update.email = emailValue
    if (phoneValue && existingPhone.startsWith('yeastar-chat:')) update.phone = phoneValue
    if (Object.keys(update).length) {
      const { error } = await db.from('contacts').update(update).eq('id', contactId).eq('account_id', params.accountId)
      // A concurrent registration can reserve a submitted phone. The match is
      // still valid, so never discard an inbound customer message for that.
      if (error && !isUniqueViolation(error)) throw error
    }
  } else {
    const { data: contact, error: contactError } = await db.from('contacts').insert({
      account_id: params.accountId,
      user_id: params.auditUserId,
      phone: phoneValue ?? `yeastar-chat:${params.connectorId}:${params.externalUserId}`,
      name,
      email: emailValue,
    }).select('id').single()
    if (contactError || !contact) throw contactError ?? new Error('Could not create Live Chat contact')
    contactId = contact.id
  }

  const { error: identityInsertError } = await db.from('omnichannel_contact_identities').insert({
    account_id: params.accountId,
    connector_id: params.connectorId,
    external_user_id: params.externalUserId,
    contact_id: contactId,
    display_name: name,
  })
  if (identityInsertError) throw identityInsertError
  return contactId
}

function safeFileName(value: string | undefined) {
  return (value ?? 'imagen').replace(/[^A-Za-z0-9._-]/g, '_').slice(-100) || 'imagen'
}

function imageMimeFromBytes(bytes: Uint8Array) {
  // Yeastar can return uploaded images as application/octet-stream. Verify the
  // actual binary signature before persisting anything in WACRM storage.
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  if (bytes.length >= 6 && String.fromCharCode(...bytes.slice(0, 6)) === 'GIF87a') return 'image/gif'
  if (bytes.length >= 6 && String.fromCharCode(...bytes.slice(0, 6)) === 'GIF89a') return 'image/gif'
  return null
}

function responsePreview(bytes: Uint8Array) {
  // Returned only in the server-side webhook receipt to diagnose PBX routes.
  // It is bounded and strips control characters; credentials never appear here.
  return new TextDecoder().decode(bytes.slice(0, 180))
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function mirrorImageToWacrm(
  db: ReturnType<typeof admin>,
  params: { accountId: string; connectorId: string; pbxUrl: string; uri: string; name?: string; expectedType?: string },
) {
  // Live Chat media URIs are served by the widget endpoint, for example
  // /api/livechat/20260811/<file-id>. /ysdisk/cache/chat is an SPA route on
  // Cloud PBXs and responds with HTML instead of the actual file.
  if (!/^[A-Za-z0-9/_-]{1,300}$/.test(params.uri)) throw new Error('Yeastar devolvió una URI de archivo inválida.')
  const fileUrl = new URL(`/api/livechat/${params.uri}`, params.pbxUrl)
  const response = await fetch(fileUrl, { headers: { 'User-Agent': 'OpenAPI' }, signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`Yeastar no permitió descargar la imagen (HTTP ${response.status}).`)
  // The file cache frequently sends application/octet-stream. The signed
  // Yeastar event includes the original file type, so use it for that case.
  const responseType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  const type = responseType?.startsWith('image/') ? responseType : params.expectedType ?? ''
  if (!type.toLowerCase().startsWith('image/')) throw new Error('El archivo recibido no es una imagen válida.')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (!bytes.byteLength || bytes.byteLength > 16 * 1024 * 1024) throw new Error('La imagen recibida excede el límite de 16 MB de NexoOmni.')
  if (!responseType?.startsWith('image/') && !imageMimeFromBytes(bytes)) {
    const preview = responsePreview(bytes)
    throw new Error(`Yeastar no devolvió una imagen (${responseType || 'sin tipo MIME'}). ${preview ? `Respuesta: ${preview}` : 'La respuesta no contiene texto.'}`)
  }
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
    // Event 30031 contains the visitor label but not the pre-chat fields.
    // Yeastar exposes name, phone and email on the associated message session.
    // Enrichment is best-effort so a temporary OpenAPI error never drops an
    // otherwise valid incoming chat message.
    let preChat: YeastarPreChatForm | null = null
    try {
      preChat = await getPreChatForm(db, connector, sessionId)
    } catch (error) {
      console.error('[yeastar-live-chat] could not load pre-chat form:', error instanceof Error ? error.message : 'unknown error')
    }
    const contactId = await resolveLiveChatContact(db, {
      accountId: connector.account_id,
      auditUserId,
      connectorId: connector.id,
      externalUserId,
      visitorName,
      preChat,
    })

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
        if (!pbxUrl) {
          const telephonyResult = await db.from('telephony_configs').select('pbx_url').eq('account_id', connector.account_id).eq('provider', 'yeastar').maybeSingle()
          if (telephonyResult.error) throw telephonyResult.error
          pbxUrl = pbxUrl ?? telephonyResult.data?.pbx_url ?? null
        }
        if (!pbxUrl) throw new Error('Falta la URL del PBX para descargar la imagen.')
        mediaUrl = await mirrorImageToWacrm(db, {
          accountId: connector.account_id,
          connectorId: connector.id,
          pbxUrl,
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

    // n8n (and any other account webhook) receives the same normalized
    // vocabulary regardless of whether the customer wrote through WhatsApp
    // or Yeastar Live Chat. This keeps external automations omnichannel and
    // prevents a Live Chat lead from silently bypassing a CRM workflow.
    if (conversationCreated) {
      await dispatchWebhookEvent(db, connector.account_id, 'conversation.created', {
        conversation_id: conversation.id,
        contact_id: contactId,
        channel_type: 'yeastar_live_chat',
        connector_id: connector.id,
      })
    }
    await dispatchWebhookEvent(db, connector.account_id, 'message.received', {
      conversation_id: conversation.id,
      contact_id: contactId,
      message_id: `yeastar:${connector.id}:${externalMessageId}`,
      channel_type: 'yeastar_live_chat',
      content_type: mediaFile ? (isImage ? 'image' : 'document') : 'text',
      text: contentText,
    })

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
