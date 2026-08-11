import crypto from 'node:crypto'

import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { requireEntitlement } from '@/lib/account/entitlements'
import { toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

type YeastarReply = {
  errcode?: number
  errmsg?: string
  access_token?: string
  access_token_expire_time?: number
  data?: { msg_id?: number | string }
}

type CachedToken = { value: string; expiresAt: number }
const tokenCache = new Map<string, CachedToken>()

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase server configuration')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

function apiUrl(pbxUrl: string, endpoint: string) {
  return new URL(`openapi/v1.0/${endpoint}`, `${pbxUrl.replace(/\/+$/, '')}/`)
}

async function reply(response: Response): Promise<YeastarReply> {
  return response.json().catch(() => ({})) as Promise<YeastarReply>
}

async function accessToken(accountId: string, pbxUrl: string, clientId: string, clientSecret: string) {
  const cacheKey = `${accountId}:${pbxUrl}`
  const cached = tokenCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const response = await fetch(apiUrl(pbxUrl, 'get_token'), {
    method: 'POST',
    // Yeastar's OpenAPI examples and the proven customer flow identify this
    // client as OpenAPI. Keep the exact convention for hosted PBXs too.
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'OpenAPI' },
    body: JSON.stringify({ username: clientId, password: clientSecret }),
    signal: AbortSignal.timeout(15_000),
  })
  const data = await reply(response)
  if (!response.ok || data.errcode !== 0 || !data.access_token) {
    throw new Error(data.errmsg || 'Yeastar no aceptó las credenciales OpenAPI.')
  }
  const ttl = Math.max(60, (data.access_token_expire_time ?? 1800) - 60)
  tokenCache.set(cacheKey, { value: data.access_token, expiresAt: Date.now() + ttl * 1000 })
  return data.access_token
}

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireEntitlement('yeastar_live_chat', 'agent')
    const limit = checkRateLimit(`omnichannel:yeastar-live-chat:send:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const conversationId = typeof body?.conversation_id === 'string' ? body.conversation_id.trim() : ''
    const text = typeof body?.content_text === 'string' ? body.content_text.trim() : ''
    if (!conversationId || !text) return NextResponse.json({ error: 'Indica una conversación y un mensaje.' }, { status: 400 })
    if (text.length > 4_000) return NextResponse.json({ error: 'El mensaje supera el límite de 4,000 caracteres de Yeastar Live Chat.' }, { status: 400 })

    const db = admin()
    const [conversationResult, monitoringResult, pbxResult] = await Promise.all([
      db.from('conversations').select('id, connector_id, external_session_id').eq('id', conversationId).eq('account_id', accountId).eq('channel_type', 'yeastar_live_chat').maybeSingle(),
      db.from('yeastar_monitoring_configs').select('api_client_id, api_client_secret').eq('account_id', accountId).maybeSingle(),
      db.from('telephony_configs').select('pbx_url').eq('account_id', accountId).eq('provider', 'yeastar').maybeSingle(),
    ])
    if (conversationResult.error) throw conversationResult.error
    if (monitoringResult.error) throw monitoringResult.error
    if (pbxResult.error) throw pbxResult.error
    const conversation = conversationResult.data
    if (!conversation?.connector_id || !conversation.external_session_id) {
      return NextResponse.json({ error: 'Esta conversación de Live Chat no tiene una sesión de Yeastar disponible.' }, { status: 409 })
    }
    // Do not use an embedded PostgREST relation here. Self-hosted Supabase can
    // retain a stale relation cache immediately after migrations; a scoped
    // point lookup is both clearer and more resilient.
    const { data: connector, error: connectorError } = await db.from('omnichannel_connectors')
      .select('outbound_pbx_url, outbound_api_client_id, outbound_api_client_secret')
      .eq('id', conversation.connector_id).eq('account_id', accountId).eq('provider', 'yeastar_live_chat').maybeSingle()
    if (connectorError) throw connectorError
    const pbxUrl = connector?.outbound_pbx_url ?? pbxResult.data?.pbx_url
    const clientId = connector?.outbound_api_client_id ?? monitoringResult.data?.api_client_id
    const clientSecret = connector?.outbound_api_client_secret ?? monitoringResult.data?.api_client_secret
    if (!clientId || !clientSecret || !pbxUrl) {
      return NextResponse.json({ error: 'Configura la URL del PBX y las credenciales OpenAPI en Configuración → Telefonía antes de responder por Live Chat.' }, { status: 409 })
    }
    const sessionId = Number(conversation.external_session_id)
    if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
      return NextResponse.json({ error: 'La sesión de Yeastar no tiene un identificador válido.' }, { status: 409 })
    }

    const token = await accessToken(
      accountId,
      pbxUrl,
      decrypt(clientId),
      decrypt(clientSecret),
    )
    const sendUrl = apiUrl(pbxUrl, 'message/send')
    sendUrl.searchParams.set('access_token', token)
    const response = await fetch(sendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'OpenAPI' },
      body: JSON.stringify({ sender_type: 9, sender_no: 'API', session_id: sessionId, msg_kind: 0, msg_type: 0, msg_body: text }),
      signal: AbortSignal.timeout(15_000),
    })
    const result = await reply(response)
    if (!response.ok || result.errcode !== 0) {
      return NextResponse.json({ error: result.errmsg || `Yeastar rechazó el envío (HTTP ${response.status}). Verifica la conexión OpenAPI de este canal.` }, { status: 502 })
    }

    const now = new Date().toISOString()
    const messageId = result.data?.msg_id ? `yeastar:out:${conversation.connector_id}:${result.data.msg_id}` : `yeastar:out:${conversation.connector_id}:${crypto.randomUUID()}`
    const { data: message, error: messageError } = await db.from('messages').insert({
      conversation_id: conversation.id,
      sender_type: 'agent',
      sender_id: userId,
      content_type: 'text',
      content_text: text,
      message_id: messageId,
      status: 'sent',
      created_at: now,
    }).select().single()
    if (messageError) throw messageError
    const { error: updateError } = await db.from('conversations').update({
      last_message_text: text,
      last_message_at: now,
      updated_at: now,
    }).eq('id', conversation.id).eq('account_id', accountId)
    if (updateError) throw updateError

    return NextResponse.json({ message })
  } catch (error) {
    return toErrorResponse(error)
  }
}
