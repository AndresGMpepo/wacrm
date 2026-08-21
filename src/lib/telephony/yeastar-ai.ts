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
  const direct = firstText(found, ['text', 'value', 'content', 'summary']) ?? firstText(value, keys)
  if (direct) return direct
  return joinSegments(found) ?? joinSegments(value)
}

export type AiResult = { cdrId: string; transcript: string | null; summary: string | null; raw: { context: unknown; summary: unknown } }

export async function fetchAiResult(db: SupabaseClient, accountId: string, callId: string, payload: JsonRecord): Promise<AiResult> {
  const [monitoring, telephony] = await Promise.all([
    db.from('yeastar_monitoring_configs').select('api_client_id, api_client_secret').eq('account_id', accountId).maybeSingle(),
    db.from('telephony_configs').select('pbx_url').eq('account_id', accountId).eq('provider', 'yeastar').maybeSingle(),
  ])
  if (monitoring.error) throw monitoring.error
  if (telephony.error) throw telephony.error
  if (!monitoring.data?.api_client_id || !monitoring.data.api_client_secret || !telephony.data?.pbx_url) throw new Error('Faltan las credenciales OpenAPI de Yeastar para consultar la IA.')
  const token = await accessToken(accountId, telephony.data.pbx_url, decrypt(monitoring.data.api_client_id), decrypt(monitoring.data.api_client_secret))
  const cdrId = String(findValue(payload, ['cdr_id', 'cdrId', 'id']) ?? callId)
  const requestYeastar = async (endpoint: string) => {
    const url = apiUrl(telephony.data!.pbx_url, endpoint, 'v2.0')
    url.searchParams.set('access_token', token)
    url.searchParams.set('id', cdrId)
    url.searchParams.set('call_id', callId)
    const response = await fetch(url, { headers: { 'User-Agent': 'OpenAPI' }, signal: AbortSignal.timeout(15_000) })
    const result = await response.json().catch(() => ({}))
    if (!response.ok || (typeof result === 'object' && result && 'errcode' in result && result.errcode !== 0)) return null
    return result
  }
  const context = await requestYeastar('cdr/getaicontext')
  const summary = await requestYeastar('cdr/getaisummary')
  const transcript = textFromResponse(context, ['transcript', 'transcription', 'text', 'content'])
  const summaryText = textFromResponse(summary, ['summary', 'call_summary', 'text', 'content'])
  return { cdrId, transcript, summary: summaryText, raw: { context, summary } }
}
