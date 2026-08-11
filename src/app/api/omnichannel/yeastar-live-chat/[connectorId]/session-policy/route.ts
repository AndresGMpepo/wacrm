import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { requireEntitlement } from '@/lib/account/entitlements'
import { toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

type YeastarReply = { errcode?: number; errmsg?: string; access_token?: string; access_token_expire_time?: number }
type ChannelSearchReply = YeastarReply & { list?: Array<{ id?: number; type?: string; channel?: string; number?: string[] }> }
type ChannelReply = YeastarReply & { data?: { id?: number; auto_close_session?: number; session_expired_time?: number; session_expired_unit?: string } }
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

async function parseReply<T extends YeastarReply>(response: Response): Promise<T> {
  return response.json().catch(() => ({})) as Promise<T>
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
  const data = await parseReply<YeastarReply>(response)
  if (!response.ok || data.errcode !== 0 || !data.access_token) throw new Error(data.errmsg || 'Yeastar no aceptó las credenciales OpenAPI.')
  tokenCache.set(cacheKey, { value: data.access_token, expiresAt: Date.now() + Math.max(60, (data.access_token_expire_time ?? 1800) - 60) * 1000 })
  return data.access_token
}

export async function POST(_request: Request, { params }: { params: Promise<{ connectorId: string }> }) {
  try {
    const { accountId } = await requireEntitlement('yeastar_live_chat', 'admin')
    const { connectorId } = await params
    const db = admin()
    const [connectorResult, monitoringResult, telephonyResult] = await Promise.all([
      db.from('omnichannel_connectors').select('id, external_channel_id, outbound_pbx_url, outbound_api_client_id, outbound_api_client_secret').eq('id', connectorId).eq('account_id', accountId).eq('provider', 'yeastar_live_chat').maybeSingle(),
      db.from('yeastar_monitoring_configs').select('api_client_id, api_client_secret').eq('account_id', accountId).maybeSingle(),
      db.from('telephony_configs').select('pbx_url').eq('account_id', accountId).eq('provider', 'yeastar').maybeSingle(),
    ])
    if (connectorResult.error) throw connectorResult.error
    if (monitoringResult.error) throw monitoringResult.error
    if (telephonyResult.error) throw telephonyResult.error
    const connector = connectorResult.data
    if (!connector) return NextResponse.json({ error: 'Canal Live Chat no encontrado.' }, { status: 404 })
    const pbxUrl = connector.outbound_pbx_url ?? telephonyResult.data?.pbx_url
    const clientId = connector.outbound_api_client_id ?? monitoringResult.data?.api_client_id
    const clientSecret = connector.outbound_api_client_secret ?? monitoringResult.data?.api_client_secret
    if (!pbxUrl || !clientId || !clientSecret) {
      return NextResponse.json({ error: 'Configura la conexión OpenAPI del canal antes de sincronizar su política.' }, { status: 409 })
    }

    const token = await accessToken(accountId, pbxUrl, decrypt(clientId), decrypt(clientSecret))
    const searchUrl = apiUrl(pbxUrl, 'message_channel/search')
    searchUrl.searchParams.set('access_token', token)
    searchUrl.searchParams.set('page', '1')
    searchUrl.searchParams.set('page_size', '100')
    searchUrl.searchParams.set('time_range', 'all')
    searchUrl.searchParams.set('search_value', connector.external_channel_id)
    const searchResponse = await fetch(searchUrl, { headers: { 'User-Agent': 'OpenAPI' }, signal: AbortSignal.timeout(15_000) })
    const search = await parseReply<ChannelSearchReply>(searchResponse)
    if (!searchResponse.ok || search.errcode !== 0) throw new Error(search.errmsg || 'Yeastar no pudo buscar el canal Live Chat.')
    const match = (search.list ?? []).find((item) => item.type === 'livechat' && item.number?.includes(connector.external_channel_id))
    if (!match?.id) return NextResponse.json({ error: `Yeastar no encontró el canal ${connector.external_channel_id} en este PBX.` }, { status: 404 })

    const detailsUrl = apiUrl(pbxUrl, 'message_channel/getlivechat')
    detailsUrl.searchParams.set('access_token', token)
    detailsUrl.searchParams.set('id', String(match.id))
    const detailsResponse = await fetch(detailsUrl, { headers: { 'User-Agent': 'OpenAPI' }, signal: AbortSignal.timeout(15_000) })
    const details = await parseReply<ChannelReply>(detailsResponse)
    if (!detailsResponse.ok || details.errcode !== 0 || !details.data) throw new Error(details.errmsg || 'Yeastar no pudo leer la política de cierre del canal.')
    const autoClose = details.data.auto_close_session === 1
    const unit = details.data.session_expired_unit
    const timeout = Number(details.data.session_expired_time)
    if (autoClose && (!Number.isSafeInteger(timeout) || timeout <= 0 || !['minite', 'hour', 'day'].includes(unit ?? ''))) {
      return NextResponse.json({ error: 'Yeastar devolvió una política de cierre no válida.' }, { status: 502 })
    }
    const syncedAt = new Date().toISOString()
    const { error: updateError } = await db.from('omnichannel_connectors').update({
      yeastar_channel_api_id: details.data.id ?? match.id,
      session_auto_close: autoClose,
      session_timeout_value: autoClose ? timeout : null,
      session_timeout_unit: autoClose ? unit : null,
      session_policy_synced_at: syncedAt,
    }).eq('id', connector.id).eq('account_id', accountId)
    if (updateError) throw updateError
    return NextResponse.json({ policy: { autoClose, timeout: autoClose ? timeout : null, unit: autoClose ? unit : null, syncedAt } })
  } catch (error) {
    return toErrorResponse(error)
  }
}
