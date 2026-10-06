import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeKey, findExistingContact } from '@/lib/contacts/dedupe'
import { apiUrl, yeastarAiConnection } from './yeastar-ai'
import { isValidE164 } from '@/lib/whatsapp/phone-utils'

export type CallContext = {
  contact: { id: string; name: string | null } | null
  current: { summary: string; customer_need: string | null; next_action: string | null } | null
  history: string | null
  nextAction: string | null
  commitments: string[]
}

export function compactCallSummary(value: string | null | undefined): string | null {
  const lines = value?.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 3).join('\n')
  return lines ? lines.slice(0, 600) : null
}

export function uniqueCallId(rows: { call_id: string }[]): string | null {
  const ids = [...new Set(rows.map((row) => row.call_id))]
  return ids.length === 1 ? ids[0] : null
}

export async function findLiveCallerCall(
  db: SupabaseClient, accountId: string, phone?: string, callId?: string, aiExtension?: string,
) {
  if (!phone && !aiExtension && !callId) return null
  const { pbxUrl, token } = await yeastarAiConnection(db, accountId)
  const url = apiUrl(pbxUrl, 'call/query')
  url.searchParams.set('access_token', token)
  if (callId) url.searchParams.set('call_id', callId)
  else if (aiExtension) url.searchParams.set('extension', aiExtension)
  else url.searchParams.set('type', 'inbound')
  const response = await fetch(url, { headers: { 'User-Agent': 'OpenAPI' }, signal: AbortSignal.timeout(15_000) })
  const result = await response.json() as {
    errcode?: number
    data?: Array<{ call_id: string; members: Array<{
      extension?: { number: string; member_status: string }
      inbound?: { from: string; member_status: string }
    }> }>
  }
  if (!response.ok || result.errcode !== 0 || !Array.isArray(result.data)) {
    throw new Error('Yeastar no pudo verificar las llamadas activas para guardar el contexto.')
  }
  // State-change webhooks are not heartbeats: an old ANSWER may be a long
  // active call or a missed BYE. Query the PBX instead of guessing by age.
  const candidates = result.data.flatMap((call) => {
    if (!call.call_id || !Array.isArray(call.members) || (callId && call.call_id !== callId)) return []
    if (aiExtension && !call.members.some((member) =>
      member.extension?.number === aiExtension && member.extension.member_status !== 'BYE')) return []
    return call.members.flatMap((member) => {
      const caller = member.inbound?.from && normalizeKey(member.inbound.from)
      return caller && isValidE164(caller) && member.inbound?.member_status !== 'BYE'
        && (!phone || caller === normalizeKey(phone)) ? [{ call_id: call.call_id, from_number: caller }] : []
    })
  })
  const unique = uniqueCallId(candidates)
  if (!unique) return null
  const numbers = [...new Set(candidates.map((row) => normalizeKey(row.from_number ?? '')))]
  return numbers.length === 1 ? { callId: unique, phone: numbers[0] } : null
}

export async function loadOwnCallContext(
  db: SupabaseClient, accountId: string, userId: string, sessionId: string,
): Promise<CallContext | null> {
  const { data: extension, error: extensionError } = await db.from('telephony_user_configs')
    .select('extension').eq('account_id', accountId).eq('user_id', userId).eq('provider', 'yeastar').maybeSingle()
  if (extensionError) throw extensionError
  if (!extension) return null
  const { data: calls, error } = await db.from('yeastar_live_calls')
    .select('call_id, peer_number, channel_id, last_event_at')
    .eq('account_id', accountId).eq('extension', extension.extension).neq('status', 'BYE').limit(50)
  if (error) throw error
  const own = (calls ?? []).find((call) =>
    (call.call_id === sessionId || call.call_id === `wacrm:${sessionId}`)
    && Date.now() - new Date(call.last_event_at).getTime() < 60_000)
  if (!own?.peer_number) return null
  const phone = normalizeKey(own.peer_number)
  const exactPbx = (calls ?? []).find((call) => call.call_id === sessionId && !call.channel_id.startsWith('wacrm:'))
  const pbxCall = exactPbx?.call_id ?? (own.channel_id.startsWith('wacrm:')
    ? uniqueCallId((calls ?? []).filter((call) =>
      !call.channel_id.startsWith('wacrm:') && normalizeKey(call.peer_number ?? '') === phone))
    : own.call_id)
  const contact = await findExistingContact(db, accountId, own.peer_number)
  const [handoff, memory, previousCall, commitments] = await Promise.all([
    pbxCall ? db.from('yeastar_call_handoffs').select('summary, customer_need, next_action')
      .eq('account_id', accountId).eq('call_id', pbxCall)
      .gte('created_at', new Date(Date.now() - 30 * 60_000).toISOString()).maybeSingle() : Promise.resolve({ data: null, error: null }),
    contact ? db.from('contact_memory').select('current_summary, next_best_action')
      .eq('account_id', accountId).eq('contact_id', contact.id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    contact ? db.from('yeastar_call_transcriptions').select('summary')
      .eq('account_id', accountId).eq('contact_id', contact.id).not('summary', 'is', null)
      .order('started_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle() : Promise.resolve({ data: null, error: null }),
    contact ? db.from('contact_commitments').select('description').eq('account_id', accountId)
      .eq('contact_id', contact.id).eq('status', 'pending')
      .order('due_date', { ascending: true, nullsFirst: false }).limit(3) : Promise.resolve({ data: [], error: null }),
  ])
  for (const result of [handoff, memory, previousCall, commitments]) if (result.error) throw result.error
  return {
    contact: contact ? { id: contact.id, name: contact.name ?? null } : null,
    current: handoff.data,
    history: compactCallSummary(memory.data?.current_summary ?? previousCall.data?.summary),
    nextAction: compactCallSummary(memory.data?.next_best_action),
    commitments: (commitments.data ?? []).map((row) => row.description),
  }
}
