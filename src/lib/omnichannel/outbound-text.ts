import crypto from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  getMetaCustomerServiceWindow,
  isMetaDirectMessageChannel,
  META_MESSAGING_WINDOW_CLOSED_MESSAGE,
} from '@/lib/omnichannel/messaging-window'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendZernioText } from '@/lib/zernio/server'

// ------------------------------------------------------------
// Server-side text sender for the omnichannel connectors.
//
// The user-facing send routes (/api/omnichannel/{zernio,meta,yeastar}/send)
// stay untouched — they own auth, entitlements and rate limiting. This
// module is the same delivery logic without the HTTP layer, so background
// runners (automations engine, flows, schedulers) can answer a Zernio,
// Meta or Yeastar Live Chat conversation the same way an agent would.
// ------------------------------------------------------------

export interface OmnichannelConversationRow {
  id: string
  channel_type: string
  connector_id: string | null
  external_session_id: string | null
  social_comment_id: string | null
}

export interface SendOmnichannelTextArgs {
  accountId: string
  conversationId: string
  text: string
  /** Defaults to `bot` — automations/flows are not a human agent. */
  senderType?: 'agent' | 'bot'
  senderId?: string | null
}

export interface SendOmnichannelTextResult {
  /** Provider-side id when the connector returned one. */
  external_message_id: string | null
  /** The `messages.message_id` value written for this send. */
  message_id: string
}

export class OmnichannelSendError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OmnichannelSendError'
  }
}

function graphVersion() {
  const configured = process.env.META_GRAPH_API_VERSION?.trim()
  return /^v\d+\.\d+$/.test(configured ?? '') ? (configured as string) : 'v22.0'
}

/**
 * Meta (and Zernio-proxied Meta) direct messages are only deliverable
 * inside the 24-hour customer service window. Checked before the network
 * call so the caller gets a readable reason instead of a Graph 400.
 */
async function assertMessagingWindow(db: SupabaseClient, conversation: OmnichannelConversationRow) {
  if (!isMetaDirectMessageChannel(conversation.channel_type, Boolean(conversation.social_comment_id))) return
  const { data, error } = await db
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!getMetaCustomerServiceWindow(data?.created_at).isOpen) {
    throw new OmnichannelSendError(META_MESSAGING_WINDOW_CLOSED_MESSAGE)
  }
}

async function sendViaZernio(
  db: SupabaseClient,
  accountId: string,
  conversation: OmnichannelConversationRow,
  text: string,
): Promise<string | null> {
  if (!conversation.connector_id || !conversation.external_session_id) {
    throw new OmnichannelSendError('La conversación no tiene un destinatario conectado disponible.')
  }
  const { data: connector, error } = await db
    .from('omnichannel_connectors')
    .select('zernio_account_id, status')
    .eq('id', conversation.connector_id)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  if (!connector?.zernio_account_id || connector.status === 'paused') {
    throw new OmnichannelSendError('El canal conectado está pausado o requiere reconexión.')
  }
  await assertMessagingWindow(db, conversation)
  return sendZernioText(conversation.external_session_id, connector.zernio_account_id as string, text)
}

async function sendViaMetaGraph(
  db: SupabaseClient,
  accountId: string,
  conversation: OmnichannelConversationRow,
  text: string,
): Promise<string | null> {
  if (!conversation.connector_id || (!conversation.external_session_id && !conversation.social_comment_id)) {
    throw new OmnichannelSendError('La conversación no tiene un destinatario Meta disponible.')
  }
  const { data: connector, error } = await db
    .from('omnichannel_connectors')
    .select('external_channel_id, meta_access_token, status')
    .eq('id', conversation.connector_id)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  if (!connector?.meta_access_token || connector.status === 'paused') {
    throw new OmnichannelSendError('El canal Meta está pausado o no tiene un token de envío configurado.')
  }
  let accessToken: string
  try {
    accessToken = decrypt(connector.meta_access_token as string)
  } catch {
    throw new OmnichannelSendError('No se pudo leer de forma segura el token de este canal Meta.')
  }
  await assertMessagingWindow(db, conversation)

  const isPublicComment = Boolean(conversation.social_comment_id)
  const endpoint = isPublicComment
    ? `https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(conversation.social_comment_id!)}/${conversation.channel_type === 'instagram' ? 'replies' : 'comments'}`
    : `https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(connector.external_channel_id as string)}/messages`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(
      isPublicComment
        ? { message: text }
        : {
            recipient: { id: conversation.external_session_id },
            ...(conversation.channel_type === 'facebook' ? { messaging_type: 'RESPONSE' } : {}),
            message: { text },
          },
    ),
    signal: AbortSignal.timeout(15_000),
  })
  const payload = (await response.json().catch(() => ({}))) as {
    message_id?: string
    id?: string
    error?: { message?: string }
  }
  const externalId = isPublicComment ? payload.id : payload.message_id
  if (!response.ok || !externalId) {
    throw new OmnichannelSendError(payload.error?.message || `Meta rechazó el envío (HTTP ${response.status}).`)
  }
  return externalId
}

type YeastarReply = {
  errcode?: number
  errmsg?: string
  access_token?: string
  access_token_expire_time?: number
  data?: { msg_id?: number | string }
}

const yeastarTokenCache = new Map<string, { value: string; expiresAt: number }>()

function yeastarApiUrl(pbxUrl: string, endpoint: string) {
  return new URL(`openapi/v1.0/${endpoint}`, `${pbxUrl.replace(/\/+$/, '')}/`)
}

async function yeastarToken(accountId: string, pbxUrl: string, clientId: string, clientSecret: string) {
  const cacheKey = `${accountId}:${pbxUrl}`
  const cached = yeastarTokenCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const response = await fetch(yeastarApiUrl(pbxUrl, 'get_token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'OpenAPI' },
    body: JSON.stringify({ username: clientId, password: clientSecret }),
    signal: AbortSignal.timeout(15_000),
  })
  const data = (await response.json().catch(() => ({}))) as YeastarReply
  if (!response.ok || data.errcode !== 0 || !data.access_token) {
    throw new OmnichannelSendError(data.errmsg || 'Yeastar no aceptó las credenciales OpenAPI.')
  }
  const ttl = Math.max(60, (data.access_token_expire_time ?? 1800) - 60)
  yeastarTokenCache.set(cacheKey, { value: data.access_token, expiresAt: Date.now() + ttl * 1000 })
  return data.access_token
}

async function sendViaYeastar(
  db: SupabaseClient,
  accountId: string,
  conversation: OmnichannelConversationRow,
  text: string,
): Promise<string | null> {
  if (!conversation.connector_id || !conversation.external_session_id) {
    throw new OmnichannelSendError('La conversación de Live Chat no tiene una sesión de Yeastar disponible.')
  }
  const sessionId = Number(conversation.external_session_id)
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
    throw new OmnichannelSendError('La sesión de Yeastar no tiene un identificador válido.')
  }
  const [connectorResult, monitoringResult, pbxResult] = await Promise.all([
    db
      .from('omnichannel_connectors')
      .select('outbound_pbx_url, outbound_api_client_id, outbound_api_client_secret')
      .eq('id', conversation.connector_id)
      .eq('account_id', accountId)
      .eq('provider', 'yeastar_live_chat')
      .maybeSingle(),
    db.from('yeastar_monitoring_configs').select('api_client_id, api_client_secret').eq('account_id', accountId).maybeSingle(),
    db.from('telephony_configs').select('pbx_url').eq('account_id', accountId).eq('provider', 'yeastar').maybeSingle(),
  ])
  if (connectorResult.error) throw connectorResult.error
  if (monitoringResult.error) throw monitoringResult.error
  if (pbxResult.error) throw pbxResult.error

  const pbxUrl = connectorResult.data?.outbound_pbx_url ?? pbxResult.data?.pbx_url
  const clientId = connectorResult.data?.outbound_api_client_id ?? monitoringResult.data?.api_client_id
  const clientSecret = connectorResult.data?.outbound_api_client_secret ?? monitoringResult.data?.api_client_secret
  if (!clientId || !clientSecret || !pbxUrl) {
    throw new OmnichannelSendError(
      'Configura la URL del PBX y las credenciales OpenAPI en Configuración → Telefonía para responder por Live Chat.',
    )
  }

  const token = await yeastarToken(accountId, pbxUrl, decrypt(clientId), decrypt(clientSecret))
  const sendUrl = yeastarApiUrl(pbxUrl, 'message/send')
  sendUrl.searchParams.set('access_token', token)
  const response = await fetch(sendUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'OpenAPI' },
    body: JSON.stringify({
      sender_type: 9,
      sender_no: 'API',
      session_id: sessionId,
      msg_kind: 0,
      msg_type: 0,
      msg_body: text,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const result = (await response.json().catch(() => ({}))) as YeastarReply
  if (!response.ok || result.errcode !== 0) {
    throw new OmnichannelSendError(result.errmsg || `Yeastar rechazó el envío (HTTP ${response.status}).`)
  }
  return result.data?.msg_id ? String(result.data.msg_id) : null
}

/**
 * Send a plain-text message on a non-WhatsApp (omnichannel) conversation and
 * persist it the same way the agent-facing routes do.
 */
export async function sendOmnichannelText(
  db: SupabaseClient,
  args: SendOmnichannelTextArgs,
): Promise<SendOmnichannelTextResult> {
  const text = args.text.trim()
  if (!text) throw new OmnichannelSendError('El mensaje está vacío.')

  const { data: conversation, error } = await db
    .from('conversations')
    .select('id, channel_type, connector_id, external_session_id, social_comment_id')
    .eq('id', args.conversationId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (error) throw error
  if (!conversation) throw new OmnichannelSendError('La conversación no existe en esta cuenta.')

  const row = conversation as OmnichannelConversationRow
  let externalId: string | null
  let prefix: string
  if (row.channel_type.startsWith('zernio_')) {
    externalId = await sendViaZernio(db, args.accountId, row, text)
    prefix = 'zernio:out'
  } else if (row.channel_type === 'facebook' || row.channel_type === 'instagram') {
    externalId = await sendViaMetaGraph(db, args.accountId, row, text)
    prefix = row.social_comment_id ? 'meta:comment' : 'meta:out'
  } else if (row.channel_type === 'yeastar_live_chat') {
    externalId = await sendViaYeastar(db, args.accountId, row, text)
    prefix = 'yeastar:out'
  } else {
    throw new OmnichannelSendError(`El canal ${row.channel_type} no admite envíos automáticos de texto.`)
  }

  const now = new Date().toISOString()
  const messageId = `${prefix}:${row.connector_id}:${externalId ?? crypto.randomUUID()}`
  const { error: messageError } = await db.from('messages').insert({
    conversation_id: row.id,
    sender_type: args.senderType ?? 'bot',
    sender_id: args.senderId ?? null,
    content_type: 'text',
    content_text: text,
    message_id: messageId,
    ...(row.channel_type.startsWith('zernio_') ? { platform_message_id: externalId } : {}),
    status: 'sent',
    created_at: now,
  })
  if (messageError) throw messageError

  const { error: updateError } = await db
    .from('conversations')
    .update({ last_message_text: text, last_message_at: now, updated_at: now })
    .eq('id', row.id)
    .eq('account_id', args.accountId)
  if (updateError) throw updateError

  return { external_message_id: externalId, message_id: messageId }
}
