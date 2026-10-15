import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'

// Shared by the live-calls board and the operational-agents board — both
// render "in call" from the `yeastar_live_calls` cache, which is only ever
// written by Yeastar's own webhook. If the webhook never delivers the final
// BYE for a call (dropped delivery, PBX restart, network blip), that cache
// row has nothing to clear it and would otherwise show an agent "in call"
// indefinitely — including hours after they disconnected. Reconciling
// against Yeastar's own `call/query` OpenAPI is the only source of truth
// that can detect and fix that case; a staleness timeout alone cannot,
// since a legitimately long call can go a long time between PBX events.

type YeastarReply = { errcode?: number; errmsg?: string; access_token?: string; access_token_expire_time?: number }
type YeastarCallReply = YeastarReply & {
  data?: Array<{ members?: Array<{ extension?: { number?: string; member_status?: string } }> }>
}
type CachedToken = { value: string; expiresAt: number }
const tokenCache = new Map<string, CachedToken>()

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

/** Deletes any PBX-originated (non-`wacrm:`) `yeastar_live_calls` row whose
 *  extension Yeastar's own live call query no longer reports as active.
 *  A no-op when OpenAPI credentials aren't configured, or there's nothing
 *  to check — callers should still work (just without this safety net). */
export async function reconcileYeastarLiveCalls(
  db: SupabaseClient,
  accountId: string,
  calls: Array<{ call_id: string; extension: string; channel_id: string }>,
  pbxUrl: string | null | undefined,
  clientId: string | null | undefined,
  clientSecret: string | null | undefined,
) {
  if (!pbxUrl || !clientId || !clientSecret) return
  const pbxCalls = calls.filter((call) => !call.channel_id.startsWith('wacrm:'))
  if (!pbxCalls.length) return
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
  await Promise.all(pbxCalls
    .filter((call) => !activeExtensions.has(call.extension))
    .map((call) => db.from('yeastar_live_calls').delete()
      .eq('account_id', accountId).eq('call_id', call.call_id).eq('extension', call.extension)))
}

/** A browser-originated (NexPhone, `wacrm:`-prefixed) call row is only kept
 *  alive by a 15s heartbeat (see live-calls/self/route.ts) — there is no
 *  PBX webhook to confirm or deny it, so staleness is the only signal. 45s
 *  tolerates a couple of missed beats without flapping a real call to "ended". */
export function isStaleSoftphoneCall(call: { channel_id: string; last_event_at: string }, now = Date.now()): boolean {
  return call.channel_id.startsWith('wacrm:') && new Date(call.last_event_at).getTime() < now - 45_000
}
