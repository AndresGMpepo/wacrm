import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Per-agent workload for a time window.
 *
 * Volume comes from the tables that already hold it (`messages`,
 * `conversation_assignment_history`, call transcriptions) and state changes
 * from `agent_activity_log`. Nothing is double-written just to be counted.
 */

export interface AgentPerformanceRow {
  user_id: string
  agent: string
  messages_sent: number
  conversations_handled: number
  conversations_closed: number
  transfers_sent: number
  transfers_received: number
  calls: number
  notes: number
  appointments_created: number
  tags_applied: number
}

export async function buildAgentPerformance(
  db: SupabaseClient,
  accountId: string,
  since: string,
): Promise<AgentPerformanceRow[]> {
  const [profiles, messages, assignments, calls, activity] = await Promise.all([
    db.from('profiles').select('user_id, full_name, email').eq('account_id', accountId),
    // Inner join keeps the scan inside this account without adding an
    // account_id column to the hottest table in the product.
    db
      .from('messages')
      .select('sender_id, conversation_id, conversations!inner(account_id)')
      .eq('conversations.account_id', accountId)
      .eq('sender_type', 'agent')
      .not('sender_id', 'is', null)
      .gte('created_at', since)
      .limit(20_000),
    db
      .from('conversation_assignment_history')
      .select('from_agent_id, to_agent_id, source')
      .eq('account_id', accountId)
      .gte('created_at', since),
    db
      .from('yeastar_call_transcriptions')
      .select('agent_user_id')
      .eq('account_id', accountId)
      .gte('created_at', since),
    db
      .from('agent_activity_log')
      .select('actor_user_id, action')
      .eq('account_id', accountId)
      .gte('created_at', since)
      .limit(20_000),
  ])

  const rows = new Map<string, AgentPerformanceRow>()
  const handled = new Map<string, Set<string>>()
  const ensure = (userId: string, name?: string): AgentPerformanceRow => {
    const existing = rows.get(userId)
    if (existing) return existing
    const created: AgentPerformanceRow = {
      user_id: userId,
      agent: name ?? userId,
      messages_sent: 0,
      conversations_handled: 0,
      conversations_closed: 0,
      transfers_sent: 0,
      transfers_received: 0,
      calls: 0,
      notes: 0,
      appointments_created: 0,
      tags_applied: 0,
    }
    rows.set(userId, created)
    return created
  }

  for (const profile of profiles.data ?? []) {
    ensure(
      profile.user_id as string,
      (profile.full_name as string) || (profile.email as string) || (profile.user_id as string),
    )
  }

  for (const message of messages.data ?? []) {
    const agent = ensure(message.sender_id as string)
    agent.messages_sent += 1
    const set = handled.get(agent.user_id) ?? new Set<string>()
    set.add(message.conversation_id as string)
    handled.set(agent.user_id, set)
  }
  for (const [userId, set] of handled) {
    ensure(userId).conversations_handled = set.size
  }

  for (const row of assignments.data ?? []) {
    // Only a person can "transfer"; routing and the AI are not credited.
    if (row.source !== 'manual') continue
    if (row.from_agent_id) ensure(row.from_agent_id as string).transfers_sent += 1
    if (row.to_agent_id) ensure(row.to_agent_id as string).transfers_received += 1
  }

  for (const row of calls.data ?? []) {
    if (row.agent_user_id) ensure(row.agent_user_id as string).calls += 1
  }

  for (const row of activity.data ?? []) {
    if (!row.actor_user_id) continue
    const agent = ensure(row.actor_user_id as string)
    if (row.action === 'conversation_closed') agent.conversations_closed += 1
    else if (row.action === 'note_added') agent.notes += 1
    else if (row.action === 'appointment_created') agent.appointments_created += 1
    else if (row.action === 'tag_added') agent.tags_applied += 1
  }

  return [...rows.values()]
    .filter(
      (row) =>
        row.messages_sent > 0 ||
        row.conversations_closed > 0 ||
        row.calls > 0 ||
        row.transfers_sent > 0 ||
        row.transfers_received > 0 ||
        row.notes > 0 ||
        row.appointments_created > 0 ||
        row.tags_applied > 0,
    )
    .sort((a, b) => b.messages_sent - a.messages_sent || a.agent.localeCompare(b.agent))
}

const CSV_HEADERS = [
  'agente',
  'mensajes_enviados',
  'conversaciones_atendidas',
  'conversaciones_cerradas',
  'transferencias_enviadas',
  'transferencias_recibidas',
  'llamadas',
  'notas',
  'citas_creadas',
  'etiquetas_aplicadas',
]

function csvCell(value: string | number): string {
  const raw = String(value ?? '')
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw
  return `"${safe.replace(/"/g, '""')}"`
}

export function agentPerformanceCsv(rows: AgentPerformanceRow[]): string {
  const body = rows.map((row) =>
    [
      row.agent,
      row.messages_sent,
      row.conversations_handled,
      row.conversations_closed,
      row.transfers_sent,
      row.transfers_received,
      row.calls,
      row.notes,
      row.appointments_created,
      row.tags_applied,
    ]
      .map(csvCell)
      .join(','),
  )
  return [CSV_HEADERS.join(','), ...body].join('\r\n')
}
