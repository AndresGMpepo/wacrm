import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { toErrorResponse } from '@/lib/auth/account'
import { requireEntitlement } from '@/lib/account/entitlements'

export const dynamic = 'force-dynamic'

type YeastarReply = { errcode?: number; errmsg?: string; access_token?: string; access_token_expire_time?: number }
type YeastarCallQueryReply = YeastarReply & {
  data?: Array<{
    call_id?: string
    members?: Array<{
      extension?: { number?: unknown; channel_id?: string; member_status?: string }
      inbound?: { from?: unknown; to?: unknown; channel_id?: string; member_status?: string }
      outbound?: { from?: unknown; to?: unknown; channel_id?: string; member_status?: string }
      internal?: { from?: unknown; to?: unknown; channel_id?: string; member_status?: string }
    }>
  }>
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

function isExtension(value: unknown, extension: string) {
  const number = value == null ? '' : String(value).trim()
  return number === extension || new RegExp(`(^|[^0-9])${extension}(?![0-9])`).test(number)
}

function samePhone(first: string | null | undefined, second: string | null | undefined) {
  const normalize = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '')
  const a = normalize(first)
  const b = normalize(second)
  return Boolean(a && b && (a === b || a.endsWith(b) || b.endsWith(a)))
}

export async function POST(request: Request) {
  let auditId: string | null = null
  let db: ReturnType<typeof admin> | null = null
  try {
    const { accountId, userId } = await requireEntitlement('yeastar_telephony', 'admin')
    const body = await request.json().catch(() => null) as { callId?: unknown; extension?: unknown; mode?: unknown } | null
    const callId = typeof body?.callId === 'string' ? body.callId : ''
    const targetExtension = typeof body?.extension === 'string' ? body.extension : ''
    const mode = body?.mode === 'whisper' || body?.mode === 'barge' ? body.mode : 'listen'
    if (!callId || !targetExtension) return NextResponse.json({ error: 'La llamada seleccionada no es válida.' }, { status: 400 })

    db = admin()
    const [supervisorResult, activeCallResult, monitoringResult, integrationResult] = await Promise.all([
      db.from('telephony_user_configs').select('extension').eq('account_id', accountId).eq('user_id', userId).eq('provider', 'yeastar').maybeSingle(),
      db.from('yeastar_live_calls').select('call_id, extension, peer_number').eq('account_id', accountId).eq('call_id', callId).eq('extension', targetExtension).maybeSingle(),
      db.from('yeastar_monitoring_configs').select('api_client_id, api_client_secret').eq('account_id', accountId).maybeSingle(),
      db.from('telephony_configs').select('pbx_url').eq('account_id', accountId).eq('provider', 'yeastar').maybeSingle(),
    ])
    if (supervisorResult.error) throw supervisorResult.error
    if (activeCallResult.error) throw activeCallResult.error
    if (monitoringResult.error) throw monitoringResult.error
    if (integrationResult.error) throw integrationResult.error

    const supervisorExtension = supervisorResult.data?.extension
    if (!supervisorExtension) return NextResponse.json({ error: 'Configura tu propia extensión Yeastar antes de supervisar.' }, { status: 409 })
    if (supervisorExtension === targetExtension) return NextResponse.json({ error: 'Usa otra extensión de supervisor; no puedes escucharte a ti mismo.' }, { status: 409 })
    const activeCall = activeCallResult.data
    if (!activeCall) return NextResponse.json({ error: 'La llamada ya finalizó o no está disponible.' }, { status: 409 })
    if (!monitoringResult.data?.api_client_id || !monitoringResult.data.api_client_secret || !integrationResult.data?.pbx_url) {
      return NextResponse.json({ error: 'Falta configurar Client ID y Client Secret de OpenAPI en Telefonía.' }, { status: 409 })
    }

    const token = await accessToken(accountId, integrationResult.data.pbx_url, decrypt(monitoringResult.data.api_client_id), decrypt(monitoringResult.data.api_client_secret))
    // A browser session ID is not a PBX channel ID. Resolve the exact active
    // extension channel at the moment the supervisor starts monitoring.
    const queryUrl = apiUrl(integrationResult.data.pbx_url, 'call/query')
    queryUrl.searchParams.set('access_token', token)
    queryUrl.searchParams.set('extension', targetExtension)
    const queryResponse = await fetch(queryUrl, {
      headers: { 'User-Agent': 'WACRM-Yeastar-Supervision/1.0' },
      signal: AbortSignal.timeout(15_000),
    })
    const query = await parseReply(queryResponse) as YeastarCallQueryReply
    if (!queryResponse.ok || query.errcode !== 0) throw new Error(query.errmsg || 'Yeastar no pudo consultar las llamadas activas.')
    let channel: { callId: string; channelId: string } | undefined
    for (const liveCall of query.data ?? []) {
      for (const member of liveCall.members ?? []) {
        const parties = [
          member.extension && { number: member.extension.number, channelId: member.extension.channel_id, status: member.extension.member_status },
          member.inbound && { number: member.inbound.from, other: member.inbound.to, channelId: member.inbound.channel_id, status: member.inbound.member_status },
          member.outbound && { number: member.outbound.from, other: member.outbound.to, channelId: member.outbound.channel_id, status: member.outbound.member_status },
          member.internal && { number: member.internal.from, other: member.internal.to, channelId: member.internal.channel_id, status: member.internal.member_status },
        ]
        const match = parties.find((party) => party?.channelId && party.status !== 'BYE' && (isExtension(party.number, targetExtension) || isExtension(party.other, targetExtension)))
        if (match?.channelId) {
          channel = { callId: liveCall.call_id ?? callId, channelId: match.channelId }
          break
        }
      }
      if (channel) break
    }
    // Linkus callId normally matches the PBX event call_id. Cloud call/query
    // can omit the extension member, and some webhook payloads omit
    // member_number, so recover the channel using that exact call association.
    if (!channel) {
      const rawCallId = callId.replace(/^wacrm:/, '')
      const { data: matchedChannels, error: matchedChannelsError } = await db.from('yeastar_live_call_channels')
        .select('call_id, channel_id, member_type, member_number, from_number, to_number, last_event_at')
        .eq('account_id', accountId).eq('call_id', rawCallId).neq('status', 'BYE')
        .order('last_event_at', { ascending: false })
      if (matchedChannelsError) throw matchedChannelsError
      const matched = (matchedChannels ?? []).find((item) => item.member_number === targetExtension)
        ?? (matchedChannels ?? []).find((item) => item.from_number === targetExtension || item.to_number === targetExtension)
        ?? (matchedChannels ?? []).find((item) => item.member_type === 'extension')
      if (matched) channel = { callId: matched.call_id, channelId: matched.channel_id }
    }
    // Final compatibility fallback for a current event where the PBX used a
    // different call identifier but did include the configured extension.
    if (!channel) {
      const since = new Date(Date.now() - 45_000).toISOString()
      const { data: channels, error: channelsError } = await db.from('yeastar_live_call_channels')
        .select('call_id, channel_id, last_event_at')
        .eq('account_id', accountId).eq('member_number', targetExtension).neq('status', 'BYE')
        .gte('last_event_at', since).order('last_event_at', { ascending: false }).limit(1)
      if (channelsError) throw channelsError
      const fallback = channels?.[0]
      if (fallback) channel = { callId: fallback.call_id, channelId: fallback.channel_id }
    }
    // When the PBX omits the extension from an event, it still reports the
    // external leg. Correlate that current leg with Linkus' active peer so a
    // WebRTC call can still be monitored without guessing a different call.
    if (!channel && activeCall.peer_number) {
      const since = new Date(Date.now() - 90_000).toISOString()
      const { data: peerChannels, error: peerChannelsError } = await db.from('yeastar_live_call_channels')
        .select('call_id, channel_id, member_type, from_number, to_number, last_event_at')
        .eq('account_id', accountId).neq('status', 'BYE').gte('last_event_at', since)
        .order('last_event_at', { ascending: false }).limit(50)
      if (peerChannelsError) throw peerChannelsError
      const peerChannel = (peerChannels ?? []).find((item) => samePhone(item.from_number, activeCall.peer_number) || samePhone(item.to_number, activeCall.peer_number))
      if (peerChannel) channel = { callId: peerChannel.call_id, channelId: peerChannel.channel_id }
    }
    if (!channel) return NextResponse.json({ error: `Yeastar aún no entregó un canal activo para la extensión ${targetExtension}. Espera unos segundos y vuelve a intentar.` }, { status: 409 })

    const { data: audit, error: auditError } = await db.from('yeastar_call_supervision_audit').insert({
      account_id: accountId,
      supervisor_user_id: userId,
      supervisor_extension: supervisorExtension,
      target_extension: targetExtension,
      call_id: channel.callId,
      channel_id: channel.channelId,
      mode,
      outcome: 'requested',
    }).select('id').single()
    if (auditError) throw auditError
    auditId = audit.id

    const url = apiUrl(integrationResult.data.pbx_url, 'call/listen')
    url.searchParams.set('access_token', token)
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'WACRM-Yeastar-Supervision/1.0' },
      body: JSON.stringify({ monitor: supervisorExtension, channel_id: channel.channelId, type: mode }),
      signal: AbortSignal.timeout(15_000),
    })
    const result = await parseReply(response)
    if (!response.ok || result.errcode !== 0) throw new Error(result.errmsg || 'Yeastar no pudo iniciar la escucha.')
    await db.from('yeastar_call_supervision_audit').update({ outcome: 'succeeded', error_message: null }).eq('id', auditId)
    const message = mode === 'whisper'
      ? 'Yeastar inició el susurro en tu extensión.'
      : mode === 'barge'
        ? 'Yeastar inició la intervención en tu extensión.'
        : 'Yeastar inició la escucha en tu extensión.'
    return NextResponse.json({ ok: true, message })
  } catch (error) {
    if (auditId && db) await db.from('yeastar_call_supervision_audit').update({ outcome: 'failed', error_message: error instanceof Error ? error.message.slice(0, 500) : 'Error desconocido' }).eq('id', auditId)
    if (error instanceof Error && !['Unauthorized', 'Forbidden'].includes(error.message)) return NextResponse.json({ error: error.message }, { status: 502 })
    return toErrorResponse(error)
  }
}
