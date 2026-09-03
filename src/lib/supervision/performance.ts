import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Per-agent workload and service times for a time window.
 *
 * Volume comes from the tables that already hold it (`messages`,
 * `conversation_assignment_history`, call transcriptions), state changes
 * from `agent_activity_log`, and connected time from
 * `member_presence_sessions`. Nothing is double-written just to be counted.
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
  /** How long the customer waited for this agent's reply, counting only
   *  time when somebody was on shift. */
  first_response_median_seconds: number | null
  first_response_samples: number
  /** From the conversation opening to the moment this agent closed it. */
  resolution_median_seconds: number | null
  resolution_samples: number
  /** Signed in, whether actively typing or idle. */
  connected_seconds: number
  /** Of the above, time reported as `online` rather than `away`. */
  active_seconds: number
}

type MessageRow = {
  conversation_id: string
  sender_id: string | null
  sender_type: string
  created_at: string
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle]
}

export async function buildAgentPerformance(
  db: SupabaseClient,
  accountId: string,
  since: string,
): Promise<AgentPerformanceRow[]> {
  const [profiles, messages, assignments, calls, activity, presence, currentPresence] =
    await Promise.all([
      db.from('profiles').select('user_id, full_name, email').eq('account_id', accountId),
      // Inner join keeps the scan inside this account without adding an
      // account_id column to the hottest table in the product. Customer
      // messages come along because response time needs both sides.
      db
        .from('messages')
        .select('conversation_id, sender_id, sender_type, created_at, conversations!inner(account_id)')
        .eq('conversations.account_id', accountId)
        // Bot replies come along on purpose: they score for nobody, but they
        // DO stop the clock — a customer the AI answered in seconds was not
        // waiting for the human who opened the chat the next morning.
        .in('sender_type', ['agent', 'customer', 'bot'])
        .gte('created_at', since)
        .order('created_at', { ascending: true })
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
        .select('actor_user_id, action, conversation_id, created_at')
        .eq('account_id', accountId)
        .gte('created_at', since)
        .limit(20_000),
      db
        .from('member_presence_sessions')
        .select('user_id, status, started_at, ended_at')
        .eq('account_id', accountId)
        // Both statuses: 'away' is an idle tab, not a logged-out agent, and
        // the heartbeat flips to it after five minutes without input.
        .gte('started_at', new Date(new Date(since).getTime() - 86_400_000).toISOString()),
      db.from('member_presence').select('user_id, last_seen_at').eq('account_id', accountId),
    ])

  const rows = new Map<string, AgentPerformanceRow>()
  const handled = new Map<string, Set<string>>()
  const firstResponses = new Map<string, { from: number; to: number; seconds: number }[]>()
  const resolutions = new Map<string, number[]>()

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
      first_response_median_seconds: null,
      first_response_samples: 0,
      resolution_median_seconds: null,
      resolution_samples: 0,
      connected_seconds: 0,
      active_seconds: 0,
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

  // ---- Messages: volume, conversations handled, response time ----
  const messageRows = (messages.data ?? []) as unknown as MessageRow[]
  // Oldest customer message still unanswered, per conversation.
  const waitingSince = new Map<string, string>()
  const firstMessageAt = new Map<string, string>()

  for (const message of messageRows) {
    const conversationId = message.conversation_id
    if (!firstMessageAt.has(conversationId)) {
      firstMessageAt.set(conversationId, message.created_at)
    }

    if (message.sender_type === 'customer') {
      if (!waitingSince.has(conversationId)) waitingSince.set(conversationId, message.created_at)
      continue
    }

    if (message.sender_type === 'bot') {
      waitingSince.delete(conversationId)
      continue
    }

    if (!message.sender_id) continue
    const agent = ensure(message.sender_id)
    agent.messages_sent += 1
    const set = handled.get(agent.user_id) ?? new Set<string>()
    set.add(conversationId)
    handled.set(agent.user_id, set)

    const waiting = waitingSince.get(conversationId)
    if (waiting) {
      const from = new Date(waiting).getTime()
      const to = new Date(message.created_at).getTime()
      const samples = firstResponses.get(agent.user_id) ?? []
      samples.push({ from, to, seconds: Math.max(0, Math.round((to - from) / 1000)) })
      firstResponses.set(agent.user_id, samples)
      waitingSince.delete(conversationId)
    }
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

  // ---- Activity: closes, notes, tags, appointments ----
  const closedConversationIds = new Set<string>()
  for (const row of activity.data ?? []) {
    if (!row.actor_user_id) continue
    const agent = ensure(row.actor_user_id as string)
    if (row.action === 'conversation_closed') {
      agent.conversations_closed += 1
      if (row.conversation_id) closedConversationIds.add(row.conversation_id as string)
    } else if (row.action === 'note_added') agent.notes += 1
    else if (row.action === 'appointment_created') agent.appointments_created += 1
    else if (row.action === 'tag_added') agent.tags_applied += 1
  }

  // ---- Resolution time ----
  if (closedConversationIds.size > 0) {
    // A conversation closed inside the window may have opened before it, so
    // the start comes from the conversation row rather than the message page.
    const { data: conversations } = await db
      .from('conversations')
      .select('id, created_at')
      .eq('account_id', accountId)
      .in('id', [...closedConversationIds])
    const openedAt = new Map<string, string>()
    for (const row of conversations ?? []) {
      openedAt.set(row.id as string, row.created_at as string)
    }
    for (const row of activity.data ?? []) {
      if (row.action !== 'conversation_closed' || !row.actor_user_id || !row.conversation_id) continue
      const start =
        openedAt.get(row.conversation_id as string) ?? firstMessageAt.get(row.conversation_id as string)
      if (!start) continue
      const seconds = Math.max(
        0,
        Math.round((new Date(row.created_at as string).getTime() - new Date(start).getTime()) / 1000),
      )
      const samples = resolutions.get(row.actor_user_id as string) ?? []
      samples.push(seconds)
      resolutions.set(row.actor_user_id as string, samples)
    }
    for (const [userId, samples] of resolutions) {
      const agent = ensure(userId)
      agent.resolution_median_seconds = median(samples)
      agent.resolution_samples = samples.length
    }
  }

  // ---- Connected time + when the team was on shift ----
  const lastSeen = new Map<string, string>()
  for (const row of currentPresence.data ?? []) {
    lastSeen.set(row.user_id as string, row.last_seen_at as string)
  }
  const windowStart = new Date(since).getTime()
  const now = Date.now()
  const staffed: { start: number; end: number }[] = []
  for (const session of presence.data ?? []) {
    const userId = session.user_id as string
    // An open session means the browser never said goodbye: bound it at the
    // agent's last heartbeat, never at now().
    const endRaw = (session.ended_at as string | null) ?? lastSeen.get(userId) ?? null
    const end = endRaw ? Math.min(new Date(endRaw).getTime(), now) : now
    const start = Math.max(new Date(session.started_at as string).getTime(), windowStart)
    if (end <= start) continue
    const agent = ensure(userId)
    agent.connected_seconds += Math.round((end - start) / 1000)
    if (session.status === 'online') agent.active_seconds += Math.round((end - start) / 1000)
    staffed.push({ start, end })
  }

  // ---- Response time, discounting hours with nobody on shift ----
  const shifts = mergeIntervals(staffed)
  for (const [userId, samples] of firstResponses) {
    const agent = ensure(userId)
    // Without presence history there is nothing to discount, so the raw
    // wait is reported rather than a flattering zero.
    const measured = shifts.length > 0 ? samples.map((sample) => staffedSeconds(sample, shifts)) : samples.map((s) => s.seconds)
    agent.first_response_median_seconds = median(measured)
    agent.first_response_samples = measured.length
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
        row.tags_applied > 0 ||
        row.connected_seconds > 0,
    )
    .sort((a, b) => b.messages_sent - a.messages_sent || a.agent.localeCompare(b.agent))
}

function mergeIntervals(intervals: { start: number; end: number }[]): { start: number; end: number }[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number }[] = []
  for (const interval of sorted) {
    const last = merged[merged.length - 1]
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end)
    else merged.push({ ...interval })
  }
  return merged
}

/** Seconds of a wait that fell inside a shift. */
function staffedSeconds(
  wait: { from: number; to: number; seconds: number },
  shifts: { start: number; end: number }[],
): number {
  let total = 0
  for (const shift of shifts) {
    const start = Math.max(wait.from, shift.start)
    const end = Math.min(wait.to, shift.end)
    if (end > start) total += end - start
  }
  return Math.round(total / 1000)
}

const CSV_HEADERS = [
  'agente',
  'mensajes_enviados',
  'conversaciones_atendidas',
  'conversaciones_cerradas',
  'respuesta_mediana_seg',
  'respuesta_muestras',
  'resolucion_mediana_seg',
  'resolucion_muestras',
  'tiempo_conectado_seg',
  'tiempo_activo_seg',
  'transferencias_enviadas',
  'transferencias_recibidas',
  'llamadas',
  'notas',
  'citas_creadas',
  'etiquetas_aplicadas',
]

function csvCell(value: string | number | null): string {
  const raw = value === null || value === undefined ? '' : String(value)
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
      row.first_response_median_seconds,
      row.first_response_samples,
      row.resolution_median_seconds,
      row.resolution_samples,
      row.connected_seconds,
      row.active_seconds,
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

/** Compact human duration for the supervision table ("2m 14s", "1h 3m"). */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}
