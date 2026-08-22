import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'

export type JsonRecord = Record<string, unknown>
type CachedToken = { value: string; expiresAt: number }
const tokenCache = new Map<string, CachedToken>()

export function apiUrl(pbxUrl: string, endpoint: string, version = 'v1.0') {
  return new URL(`openapi/${version}/${endpoint}`, `${pbxUrl.replace(/\/+$/, '')}/`)
}

export async function accessToken(accountId: string, pbxUrl: string, clientId: string, clientSecret: string) {
  const cached = tokenCache.get(accountId)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const response = await fetch(apiUrl(pbxUrl, 'get_token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'OpenAPI' },
    body: JSON.stringify({ username: clientId, password: clientSecret }),
    signal: AbortSignal.timeout(15_000),
  })
  const result = await response.json().catch(() => ({})) as { errcode?: number; errmsg?: string; access_token?: string; access_token_expire_time?: number }
  if (!response.ok || result.errcode !== 0 || !result.access_token) throw new Error(result.errmsg || 'Yeastar no aceptó las credenciales OpenAPI.')
  tokenCache.set(accountId, { value: result.access_token, expiresAt: Date.now() + Math.max(60, (result.access_token_expire_time ?? 1800) - 60) * 1000 })
  return result.access_token
}

export function findValue(value: unknown, keys: string[]): unknown {
  if (!value || typeof value !== 'object') return undefined
  if (Array.isArray(value)) { for (const item of value) { const found = findValue(item, keys); if (found !== undefined) return found } return undefined }
  const record = value as JsonRecord
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key]
  for (const child of Object.values(record)) { const found = findValue(child, keys); if (found !== undefined) return found }
  return undefined
}

export function firstText(value: unknown, keys: string[]): string | null {
  if (!value || typeof value !== 'object') return null
  const record = value as JsonRecord
  for (const key of keys) if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim()
  return null
}

// Some Yeastar deployments return the transcript/summary as an array of
// speaker turns (e.g. [{ speaker, text }]) instead of a single string field.
// Join those into readable lines rather than silently dropping the content.
function joinSegments(value: unknown): string | null {
  if (!Array.isArray(value) || !value.length) return null
  const lines = value.map((item) => {
    if (typeof item === 'string') return item.trim() || null
    if (item && typeof item === 'object') {
      const record = item as JsonRecord
      const speaker = firstText(record, ['speaker', 'role', 'name', 'party'])
      const text = firstText(record, ['text', 'content', 'sentence', 'message', 'value'])
      if (!text) return null
      return speaker ? `${speaker}: ${text}` : text
    }
    return null
  }).filter((line): line is string => Boolean(line))
  return lines.length ? lines.join('\n') : null
}

export function textFromResponse(value: unknown, keys: string[]): string | null {
  const found = findValue(value, keys)
  // findValue already resolves straight to the matched value — if that's a
  // plain string, use it as-is instead of trying to unwrap it as an object.
  if (typeof found === 'string' && found.trim()) return found.trim()
  const direct = firstText(found, ['text', 'value', 'content', 'summary']) ?? firstText(value, keys)
  if (direct) return direct
  return joinSegments(found) ?? joinSegments(value)
}

// Matches the confirmed getaicontext (v2.0) response shape:
// { data: { leg_1: { context: [{ content, source_number, name, timestamp }] }, leg_2: {...} } }
function buildTranscriptFromContext(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const data = (result as JsonRecord).data
  if (!data || typeof data !== 'object') return null
  const turns: { label: string | null; content: string; timestamp: number }[] = []
  for (const leg of Object.values(data as JsonRecord)) {
    const context = leg && typeof leg === 'object' ? (leg as JsonRecord).context : undefined
    if (!Array.isArray(context)) continue
    for (const turn of context) {
      if (!turn || typeof turn !== 'object') continue
      const record = turn as JsonRecord
      const content = typeof record.content === 'string' ? record.content.trim() : ''
      if (!content) continue
      const label = firstText(record, ['name', 'source_number'])
      const timestamp = typeof record.timestamp === 'number' ? record.timestamp : 0
      turns.push({ label, content, timestamp })
    }
  }
  if (!turns.length) return null
  turns.sort((a, b) => a.timestamp - b.timestamp)
  return turns.map((turn) => (turn.label ? `${turn.label}: ${turn.content}` : turn.content)).join('\n')
}

export type AiResult = {
  cdrId: string
  transcript: string | null
  contextError: string | null
  raw: { context: unknown }
}

export async function fetchAiResult(db: SupabaseClient, accountId: string, callId: string, payload: JsonRecord): Promise<AiResult> {
  const [monitoring, telephony] = await Promise.all([
    db.from('yeastar_monitoring_configs').select('api_client_id, api_client_secret').eq('account_id', accountId).maybeSingle(),
    db.from('telephony_configs').select('pbx_url').eq('account_id', accountId).eq('provider', 'yeastar').maybeSingle(),
  ])
  if (monitoring.error) throw monitoring.error
  if (telephony.error) throw telephony.error
  if (!monitoring.data?.api_client_id || !monitoring.data.api_client_secret || !telephony.data?.pbx_url) throw new Error('Faltan las credenciales OpenAPI de Yeastar para consultar la IA.')
  const pbxUrl = telephony.data.pbx_url
  const token = await accessToken(accountId, pbxUrl, decrypt(monitoring.data.api_client_id), decrypt(monitoring.data.api_client_secret))
  // Confirmed against Yeastar's official docs (Get AI Call Transcript v2.0):
  // cdr_ids is the call LEG id, which matches the webhook's `call_note_id`
  // format (yyyyMMddHHmmss-XXXXX) — NOT `uid` or `call_id`.
  const cdrId = String(findValue(payload, ['call_note_id', 'leg_id', 'uid', 'cdr_id', 'cdrId', 'id']) ?? callId)
  const requestYeastar = async (endpoint: string, params: Record<string, string>) => {
    const url = apiUrl(pbxUrl, endpoint, 'v2.0')
    url.searchParams.set('access_token', token)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    const response = await fetch(url, { headers: { 'User-Agent': 'OpenAPI' }, signal: AbortSignal.timeout(15_000) })
    const result = await response.json().catch(() => ({})) as JsonRecord
    const errcode = typeof result === 'object' && result && 'errcode' in result ? result.errcode : undefined
    const ok = response.ok && (errcode === undefined || errcode === 0)
    const error = ok ? null : (typeof result.errmsg === 'string' && result.errmsg) || `HTTP ${response.status}${errcode !== undefined ? `, errcode ${errcode}` : ''}`
    return { ok, result, error }
  }
  const context = await requestYeastar('cdr/getaicontext', { cdr_ids: cdrId })
  const transcript = context.ok ? (buildTranscriptFromContext(context.result) ?? textFromResponse(context.result, ['transcript', 'transcription', 'text', 'content'])) : null
  return {
    cdrId,
    transcript,
    contextError: context.ok ? null : context.error,
    raw: { context: context.result },
  }
}

export type CdrDetail = {
  callDurationSeconds: number | null
  routingDurationSeconds: number | null
  handlingDurationSeconds: number | null
  ringDurationSeconds: number | null
  holdDurationSeconds: number | null
  talkDurationSeconds: number | null
  disconnectedBy: string | null
  timeline: Array<{ leg: number; events: Array<{ name: string; timeSeconds: number; at: string | null; content: unknown }> }>
}

// GET /openapi/v2.0/cdr/detail?uid=<uid> — the duration breakdown and call
// flow chronology shown in Yeastar's "Detalles del CDR" screen.
export async function fetchCdrDetail(db: SupabaseClient, accountId: string, uid: string): Promise<CdrDetail | null> {
  const [monitoring, telephony] = await Promise.all([
    db.from('yeastar_monitoring_configs').select('api_client_id, api_client_secret').eq('account_id', accountId).maybeSingle(),
    db.from('telephony_configs').select('pbx_url').eq('account_id', accountId).eq('provider', 'yeastar').maybeSingle(),
  ])
  if (monitoring.error) throw monitoring.error
  if (telephony.error) throw telephony.error
  if (!monitoring.data?.api_client_id || !monitoring.data.api_client_secret || !telephony.data?.pbx_url) throw new Error('Faltan las credenciales OpenAPI de Yeastar para consultar la IA.')
  const pbxUrl = telephony.data.pbx_url
  const token = await accessToken(accountId, pbxUrl, decrypt(monitoring.data.api_client_id), decrypt(monitoring.data.api_client_secret))
  const url = apiUrl(pbxUrl, 'cdr/detail', 'v2.0')
  url.searchParams.set('access_token', token)
  url.searchParams.set('uid', uid)
  const response = await fetch(url, { headers: { 'User-Agent': 'OpenAPI' }, signal: AbortSignal.timeout(15_000) })
  const result = await response.json().catch(() => ({})) as JsonRecord
  const errcode = typeof result.errcode === 'number' ? result.errcode : undefined
  if (!response.ok || (errcode !== undefined && errcode !== 0)) return null
  const data = result.data as JsonRecord | undefined
  const basic = data?.basic as JsonRecord | undefined
  if (!basic) return null
  const num = (value: unknown) => (typeof value === 'number' ? value : null)
  const timelineRaw = Array.isArray(data?.timeline) ? data.timeline as JsonRecord[] : []
  const timeline = timelineRaw.map((leg) => ({
    leg: typeof leg.leg === 'number' ? leg.leg : 0,
    events: (Array.isArray(leg.event_list) ? leg.event_list as JsonRecord[] : []).map((event) => ({
      name: typeof event.event_name === 'string' ? event.event_name : 'event',
      timeSeconds: typeof event.event_time === 'number' ? event.event_time : 0,
      at: typeof event.event_ts === 'string' ? event.event_ts : null,
      content: event.event_content ?? null,
    })),
  }))
  return {
    callDurationSeconds: num(basic.call_duration),
    routingDurationSeconds: num(basic.routing_duration),
    handlingDurationSeconds: num(basic.handling_duration),
    ringDurationSeconds: num(basic.ring_duration),
    holdDurationSeconds: num(basic.hold_duration),
    talkDurationSeconds: num(basic.talk_duration),
    disconnectedBy: typeof basic.disconnected_by === 'string' ? basic.disconnected_by : null,
    timeline,
  }
}

