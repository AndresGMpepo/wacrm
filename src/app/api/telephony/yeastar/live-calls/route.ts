import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { toErrorResponse } from '@/lib/auth/account'
import { requireEntitlement } from '@/lib/account/entitlements'

export const dynamic = 'force-dynamic'

type YeastarReply = { errcode?: number; errmsg?: string; access_token?: string; access_token_expire_time?: number }
type YeastarCallReply = YeastarReply & {
  data?: Array<{ members?: Array<{ extension?: { number?: string; member_status?: string } }> }>
}
type CachedToken = { value: string; expiresAt: number }
const tokenCache = new Map<string, CachedToken>()

function admin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

function apiUrl(pbxUrl: string, endpoint: string) {
  return new URL(`openapi/v1.0/${endpoint}`, `${pbxUrl.replace(/\/+$/, '')}/`)
}

async function parseReply(response: Response): Promise<YeastarReply> {
  return response.json().catch(() => ({})) as Promise<YeastarReply>
}

async function accessToken(accountId: string, pbxUrl: string, clientId: string, clientSecret: string) {
  const cached = tokenCache.get(accountId)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const response = await fetch(apiUrl(pbxUrl, 'get_token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'WACRM-Yeastar-Supervision/1.0' },
    body: JSON.stringify({ username: clientId, password: clientSecret }),
    signal: AbortSignal.timeout(15_000),
  })
  const data = await parseReply(response)
  if (!response.ok || data.errcode !== 0 || !data.access_token) throw new Error(data.errmsg || 'Yeastar no aceptó las credenciales OpenAPI.')
  const ttl = Math.max(60, (data.access_token_expire_time ?? 1800) - 60)
  tokenCache.set(accountId, { value: data.access_token, expiresAt: Date.now() + ttl * 1000 })
  return data.access_token
}

async function reconcilePbXCalls(db: ReturnType<typeof admin>, accountId: string, calls: Array<{ call_id: string; extension: string; channel_id: string }>, pbxUrl: string | null | undefined, clientId: string | null | undefined, clientSecret: string | null | undefined) {
  if (!pbxUrl || !clientId || !clientSecret) return
  const token = await accessToken(accountId, pbxUrl, decrypt(clientId), decrypt(clientSecret))
  const url = apiUrl(pbxUrl, 'call/query')
  url.searchParams.set('access_token', token)
  const response = await fetch(url, { headers: { 'User-Agent': 'WACRM-Yeastar-Supervision/1.0' }, signal: AbortSignal.timeout(15_000) })
  const result = await parseReply(response) as YeastarCallReply
  if (!response.ok || result.errcode !== 0) throw new Error(result.errmsg || 'Yeastar no pudo consultar las llamadas activas.')

  const activeExtensions = new Set((result.data ?? []).flatMap((call) => (call.members ?? []).flatMap((member) => {
    const extension = member.extension
    return extension?.number && extension.member_status !== 'BYE' ? [extension.number] : []
  })))
  // Rows written from PBX webhooks are cache only. Yeastar's live query is
  // authoritative and removes an ALERT/ANSWER row when its final BYE webhook
  // was not delivered.
  await Promise.all(calls
    .filter((call) => !call.channel_id.startsWith('wacrm:') && !activeExtensions.has(call.extension))
    .map((call) => db.from('yeastar_live_calls').delete()
      .eq('account_id', accountId).eq('call_id', call.call_id).eq('extension', call.extension)))
}

export async function GET() {
  try {
    const { accountId } = await requireEntitlement('yeastar_telephony', 'admin')
    const db = admin()
    const [callsResult, extensionsResult, membersResult, channelsResult, monitoringResult, integrationResult] = await Promise.all([
      db.from('yeastar_live_calls').select('call_id, extension, channel_id, peer_number, direction, status, call_path, last_event_at')
        .eq('account_id', accountId).order('last_event_at', { ascending: false }).limit(100),
      db.from('telephony_user_configs').select('user_id, extension').eq('account_id', accountId).eq('provider', 'yeastar'),
      db.from('profiles').select('user_id, full_name, avatar_url').eq('account_id', accountId),
      db.from('yeastar_live_call_channels').select('call_id').eq('account_id', accountId),
      db.from('yeastar_monitoring_configs').select('api_client_id, api_client_secret').eq('account_id', accountId).maybeSingle(),
      db.from('telephony_configs').select('pbx_url').eq('account_id', accountId).eq('provider', 'yeastar').maybeSingle(),
    ])
    if (callsResult.error) throw callsResult.error
    if (extensionsResult.error) throw extensionsResult.error
    if (membersResult.error) throw membersResult.error
    if (channelsResult.error) throw channelsResult.error
    if (monitoringResult.error) throw monitoringResult.error
    if (integrationResult.error) throw integrationResult.error
    await reconcilePbXCalls(
      db,
      accountId,
      callsResult.data ?? [],
      integrationResult.data?.pbx_url,
      monitoringResult.data?.api_client_id,
      monitoringResult.data?.api_client_secret,
    )
    // Re-read after reconciliation so the response never renders a known
    // stale webhook row.
    if (callsResult.data?.some((call) => !call.channel_id.startsWith('wacrm:'))) {
      const { data, error } = await db.from('yeastar_live_calls').select('call_id, extension, channel_id, peer_number, direction, status, call_path, last_event_at')
        .eq('account_id', accountId).order('last_event_at', { ascending: false }).limit(100)
      if (error) throw error
      callsResult.data = data
    }
    const usersByExtension = new Map((extensionsResult.data ?? []).map((row) => [row.extension, row.user_id]))
    const memberById = new Map((membersResult.data ?? []).map((row) => [row.user_id, row]))
    // A customer number must never be rendered as an agent extension. The
    // webhook handler persists only configured extensions; this filter also
    // hides any legacy row written before that protection existed.
    const channelCallIds = new Set((channelsResult.data ?? []).map((channel) => channel.call_id))
    const latestByExtension = new Map<string, NonNullable<typeof callsResult.data>[number]>()
    const staleSoftphoneBefore = Date.now() - 45_000
    for (const call of callsResult.data ?? []) {
      if (!usersByExtension.has(call.extension)) continue
      const isSoftphoneCall = call.channel_id.startsWith('wacrm:')
      // PBX rows remain visible only while at least one associated PBX channel
      // is active. This removes historical ALERT/ANSWER rows once BYE arrives.
      if (!isSoftphoneCall && !channelCallIds.has(call.call_id)) continue
      // Browser-originated calls send a heartbeat every 15 seconds. If the
      // tab closes before its final DELETE reaches us, hide that stale row
      // without expiring long-running PBX-originated calls.
      if (isSoftphoneCall && new Date(call.last_event_at).getTime() < staleSoftphoneBefore) continue
      const current = latestByExtension.get(call.extension)
      if (!current || new Date(call.last_event_at).getTime() > new Date(current.last_event_at).getTime()) latestByExtension.set(call.extension, call)
    }
    const calls = [...latestByExtension.values()].map((call) => {
      const member = memberById.get(usersByExtension.get(call.extension) ?? '')
      const rawCallId = call.call_id.replace(/^wacrm:/, '')
      return {
        ...call,
        agent: member ? { name: member.full_name, avatarUrl: member.avatar_url } : null,
        listenReady: !call.channel_id.startsWith('wacrm:') || channelCallIds.has(rawCallId),
      }
    })
    return NextResponse.json({ calls })
  } catch (error) {
    return toErrorResponse(error)
  }
}
