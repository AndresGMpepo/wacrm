import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

export const dynamic = 'force-dynamic'

type YeastarReply = { errcode?: number; errmsg?: string; access_token?: string; access_token_expire_time?: number }
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

export async function POST(request: Request) {
  let auditId: string | null = null
  let db: ReturnType<typeof admin> | null = null
  try {
    const { accountId, userId } = await requireRole('admin')
    const body = await request.json().catch(() => null) as { callId?: unknown; extension?: unknown } | null
    const callId = typeof body?.callId === 'string' ? body.callId : ''
    const targetExtension = typeof body?.extension === 'string' ? body.extension : ''
    if (!callId || !targetExtension) return NextResponse.json({ error: 'La llamada seleccionada no es válida.' }, { status: 400 })

    db = admin()
    const [supervisorResult, activeCallResult, monitoringResult, integrationResult] = await Promise.all([
      db.from('telephony_user_configs').select('extension').eq('account_id', accountId).eq('user_id', userId).eq('provider', 'yeastar').maybeSingle(),
      db.from('yeastar_live_calls').select('call_id, extension').eq('account_id', accountId).eq('call_id', callId).eq('extension', targetExtension).maybeSingle(),
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
    if (!activeCallResult.data) return NextResponse.json({ error: 'La llamada ya finalizó o no está disponible.' }, { status: 409 })
    if (!monitoringResult.data?.api_client_id || !monitoringResult.data.api_client_secret || !integrationResult.data?.pbx_url) {
      return NextResponse.json({ error: 'Falta configurar Client ID y Client Secret de OpenAPI en Telefonía.' }, { status: 409 })
    }

    const rawCallId = callId.replace(/^wacrm:/, '')
    const { data: channels, error: channelsError } = await db.from('yeastar_live_call_channels')
      .select('channel_id, member_type, member_number, from_number, to_number, status')
      .eq('account_id', accountId).eq('call_id', rawCallId).order('last_event_at', { ascending: false })
    if (channelsError) throw channelsError
    const channel = (channels ?? []).find((item) => item.member_number === targetExtension)
      ?? (channels ?? []).find((item) => item.from_number === targetExtension || item.to_number === targetExtension)
      ?? (channels ?? []).find((item) => item.member_type === 'extension')
    if (!channel) return NextResponse.json({ error: 'Yeastar aún no entregó un canal PBX para esta llamada. Espera unos segundos y vuelve a intentar.' }, { status: 409 })

    const { data: audit, error: auditError } = await db.from('yeastar_call_supervision_audit').insert({
      account_id: accountId,
      supervisor_user_id: userId,
      supervisor_extension: supervisorExtension,
      target_extension: targetExtension,
      call_id: callId,
      channel_id: channel.channel_id,
      mode: 'listen',
      outcome: 'requested',
    }).select('id').single()
    if (auditError) throw auditError
    auditId = audit.id

    const token = await accessToken(accountId, integrationResult.data.pbx_url, decrypt(monitoringResult.data.api_client_id), decrypt(monitoringResult.data.api_client_secret))
    const url = apiUrl(integrationResult.data.pbx_url, 'call/listen')
    url.searchParams.set('access_token', token)
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'WACRM-Yeastar-Supervision/1.0' },
      body: JSON.stringify({ monitor: supervisorExtension, channel_id: channel.channel_id, type: 'listen' }),
      signal: AbortSignal.timeout(15_000),
    })
    const result = await parseReply(response)
    if (!response.ok || result.errcode !== 0) throw new Error(result.errmsg || 'Yeastar no pudo iniciar la escucha.')
    await db.from('yeastar_call_supervision_audit').update({ outcome: 'succeeded', error_message: null }).eq('id', auditId)
    return NextResponse.json({ ok: true, message: 'Yeastar inició la escucha en tu extensión.' })
  } catch (error) {
    if (auditId && db) await db.from('yeastar_call_supervision_audit').update({ outcome: 'failed', error_message: error instanceof Error ? error.message.slice(0, 500) : 'Error desconocido' }).eq('id', auditId)
    if (error instanceof Error && !['Unauthorized', 'Forbidden'].includes(error.message)) return NextResponse.json({ error: error.message }, { status: 502 })
    return toErrorResponse(error)
  }
}
