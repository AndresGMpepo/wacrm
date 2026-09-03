import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Customer traceability: every touch a contact had, in one ordered list.
 *
 * Answers "who attended this customer, who took over afterwards, and who
 * spoke with them on the phone" — which used to be unanswerable because
 * `conversations.assigned_agent_id` only keeps the current owner and calls
 * live in a separate table.
 */

export type TraceEventType =
  | 'conversation_started'
  | 'assignment'
  | 'agent_replied'
  | 'call'
  | 'contact_archived'
  | 'contact_restored'

export interface TraceEvent {
  at: string
  type: TraceEventType
  /** Human-readable agent name, resolved from the account roster. */
  agent: string | null
  agent_id: string | null
  channel: string | null
  conversation_id: string | null
  detail: string
}

interface AgentDirectory {
  name(userId: string | null | undefined): string | null
}

async function loadAgentDirectory(
  db: SupabaseClient,
  accountId: string,
): Promise<AgentDirectory> {
  const { data } = await db
    .from('profiles')
    .select('user_id, full_name, email')
    .eq('account_id', accountId)
  const byId = new Map<string, string>()
  for (const row of data ?? []) {
    byId.set(row.user_id as string, (row.full_name as string) || (row.email as string) || (row.user_id as string))
  }
  return {
    name: (userId) => (userId ? byId.get(userId) ?? userId : null),
  }
}

export async function buildContactTrace(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<TraceEvent[]> {
  const directory = await loadAgentDirectory(db, accountId)

  const { data: conversations } = await db
    .from('conversations')
    .select('id, channel_type, created_at, channel_source_label')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at')
  const conversationIds = (conversations ?? []).map((c) => c.id as string)
  const channelOf = new Map<string, string>()
  for (const c of conversations ?? []) {
    channelOf.set(c.id as string, (c.channel_type as string) ?? 'whatsapp')
  }

  const [assignments, agentMessages, calls, audit] = await Promise.all([
    db
      .from('conversation_assignment_history')
      .select('conversation_id, from_agent_id, to_agent_id, queue_id, source, actor_user_id, created_at')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .order('created_at'),
    conversationIds.length
      ? db
          .from('messages')
          .select('conversation_id, sender_id, created_at')
          .in('conversation_id', conversationIds)
          .eq('sender_type', 'agent')
          .not('sender_id', 'is', null)
          .order('created_at')
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    db
      .from('yeastar_call_transcriptions')
      .select('agent_user_id, agent_extension, direction, started_at, ended_at, duration_seconds, summary, created_at')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .order('created_at'),
    db
      .from('contact_audit_log')
      .select('action, actor_user_id, reason, created_at')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .order('created_at'),
  ])

  const events: TraceEvent[] = []

  for (const conversation of conversations ?? []) {
    events.push({
      at: conversation.created_at as string,
      type: 'conversation_started',
      agent: null,
      agent_id: null,
      channel: (conversation.channel_type as string) ?? 'whatsapp',
      conversation_id: conversation.id as string,
      detail: (conversation.channel_source_label as string) || 'Conversación iniciada por el cliente',
    })
  }

  for (const row of assignments.data ?? []) {
    const to = directory.name(row.to_agent_id as string | null)
    const from = directory.name(row.from_agent_id as string | null)
    const source =
      row.source === 'manual' ? 'asignación manual' : row.source === 'released' ? 'liberada' : 'asignación automática'
    events.push({
      at: row.created_at as string,
      type: 'assignment',
      agent: to,
      agent_id: (row.to_agent_id as string) ?? null,
      channel: channelOf.get(row.conversation_id as string) ?? null,
      conversation_id: (row.conversation_id as string) ?? null,
      detail: to
        ? `${from ? `De ${from} a ${to}` : `Asignada a ${to}`} (${source})`
        : `Conversación sin agente (${source})`,
    })
  }

  // One event per agent per conversation: the moment that person first
  // wrote. A row per message would bury the trace in noise.
  const seenReplies = new Set<string>()
  for (const row of (agentMessages.data ?? []) as Record<string, unknown>[]) {
    const key = `${row.conversation_id}:${row.sender_id}`
    if (seenReplies.has(key)) continue
    seenReplies.add(key)
    events.push({
      at: row.created_at as string,
      type: 'agent_replied',
      agent: directory.name(row.sender_id as string),
      agent_id: (row.sender_id as string) ?? null,
      channel: channelOf.get(row.conversation_id as string) ?? null,
      conversation_id: (row.conversation_id as string) ?? null,
      detail: 'Primera respuesta de este agente en la conversación',
    })
  }

  for (const row of calls.data ?? []) {
    const seconds = Number(row.duration_seconds) || 0
    const minutes = Math.floor(seconds / 60)
    const direction = row.direction === 'outbound' ? 'Llamada saliente' : row.direction === 'inbound' ? 'Llamada entrante' : 'Llamada'
    events.push({
      at: (row.started_at as string) || (row.created_at as string),
      type: 'call',
      agent: directory.name(row.agent_user_id as string | null) ?? ((row.agent_extension as string) || null),
      agent_id: (row.agent_user_id as string) ?? null,
      channel: 'telefonía',
      conversation_id: null,
      detail: `${direction} · ${minutes}m ${seconds % 60}s${row.summary ? ` · ${String(row.summary).slice(0, 200)}` : ''}`,
    })
  }

  for (const row of audit.data ?? []) {
    if (row.action !== 'archived' && row.action !== 'restored') continue
    events.push({
      at: row.created_at as string,
      type: row.action === 'archived' ? 'contact_archived' : 'contact_restored',
      agent: directory.name(row.actor_user_id as string | null),
      agent_id: (row.actor_user_id as string) ?? null,
      channel: null,
      conversation_id: null,
      detail: row.action === 'archived' ? 'Contacto archivado' : 'Contacto restaurado',
    })
  }

  return events.sort((a, b) => a.at.localeCompare(b.at))
}

const CSV_HEADERS = ['fecha', 'evento', 'agente', 'canal', 'conversacion', 'detalle']

/** Quote every field: names and summaries contain commas and quotes, and a
 *  leading =/+/-/@ would be executed as a formula by Excel. */
function csvCell(value: string | null): string {
  const raw = value ?? ''
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw
  return `"${safe.replace(/"/g, '""')}"`
}

export function contactTraceCsv(events: TraceEvent[]): string {
  const rows = events.map((event) =>
    [
      event.at,
      event.type,
      event.agent,
      event.channel,
      event.conversation_id,
      event.detail,
    ]
      .map(csvCell)
      .join(','),
  )
  return [CSV_HEADERS.join(','), ...rows].join('\r\n')
}
