import { createClient as createAdminClient } from '@supabase/supabase-js'

export type OperatingMode = 'commercial' | 'support' | 'hybrid'
type ConversationRow = {
  id: string
  assigned_agent_id: string | null
  status: string
  channel_type: string | null
  created_at: string
}
type MessageRow = { conversation_id: string; sender_type: string; created_at: string }
type AnalysisRow = { conversation_id: string; sentiment: string | null; sentiment_score: number | null; qa_score: number | null }
type AppointmentRow = { status: string; contact_id: string | null; created_at: string }
type DealChannel = 'whatsapp' | 'yeastar_live_chat' | 'yeastar_voice' | 'facebook' | 'instagram' | 'tiktok' | 'other'
type DealStageRow = { name: string; position: number }
type DealRow = { value: number | string | null; status: string; updated_at: string; source_broadcast_id: string | null; source_channel: DealChannel | null; stage: DealStageRow | DealStageRow[] | null }
type BroadcastRow = {
  id: string; name: string; template_name: string; status: string; created_at: string
  total_recipients: number | null; sent_count: number | null; delivered_count: number | null
  read_count: number | null; replied_count: number | null; failed_count: number | null
}

export const MAX_RANGE_DAYS = 365
const MAX_CONVERSATIONS_FOR_RESPONSE_METRICS = 5_000

export function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase server configuration')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

function dayStart(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

function dateOnly(date: Date) { return date.toISOString().slice(0, 10) }
function plusDays(date: Date, days: number) { return new Date(date.getTime() + days * 86_400_000) }
function numeric(value: number | string | null) { return Number(value ?? 0) || 0 }
function percentage(numerator: number, denominator: number) { return denominator > 0 ? Math.round((numerator / denominator) * 100) : null }
function dealChannelLabel(channel: DealChannel | null) {
  return channel === 'whatsapp' ? 'WhatsApp'
    : channel === 'yeastar_live_chat' ? 'Chat web Yeastar'
      : channel === 'yeastar_voice' ? 'Llamada Yeastar'
        : channel === 'facebook' ? 'Facebook'
          : channel === 'instagram' ? 'Instagram'
            : channel === 'tiktok' ? 'TikTok'
              : channel === 'other' ? 'Otro'
                : 'Sin canal confirmado'
}

// Zernio-connected channels are stored as `zernio_whatsapp`/`zernio_facebook`/
// `zernio_instagram` on conversations, but must never surface that internal
// provider name commercially — always display the base channel instead.
function channelTypeLabel(channelType: string | null) {
  const normalized = channelType?.replace(/^zernio_/, '') || null
  return normalized === 'yeastar_live_chat' ? 'Chat web Yeastar'
    : normalized === 'yeastar_voice' ? 'Llamada Yeastar'
      : normalized === 'facebook' ? 'Facebook'
        : normalized === 'instagram' ? 'Instagram'
          : normalized === 'tiktok' ? 'TikTok'
            : normalized === 'whatsapp' || !normalized ? 'WhatsApp'
              : normalized
}

/** Computes the report window (+previous-period comparison window) from two
 *  YYYY-MM-DD strings. Shared by the executive report route (parses them out
 *  of the URL) and the AI dictamen route (gets them straight from the request
 *  body) so both always compute date math identically. */
export function computeRange(fromParam: string | null, toParam: string | null) {
  const today = new Date()
  const defaultEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const toStart = dayStart(toParam ?? '') ?? defaultEnd
  const fromStart = dayStart(fromParam ?? '') ?? plusDays(toStart, -29)
  const dayCount = Math.round((toStart.getTime() - fromStart.getTime()) / 86_400_000) + 1
  if (fromStart > toStart || dayCount < 1 || dayCount > MAX_RANGE_DAYS) {
    throw new Error('El periodo debe tener entre 1 y 365 días.')
  }
  const endExclusive = plusDays(toStart, 1)
  return {
    from: fromStart.toISOString(),
    toExclusive: endExclusive.toISOString(),
    previousFrom: plusDays(fromStart, -dayCount).toISOString(),
    previousToExclusive: fromStart.toISOString(),
    fromDate: dateOnly(fromStart),
    toDate: dateOnly(toStart),
    dayCount,
  }
}

export type ExecutiveReportRange = ReturnType<typeof computeRange>

async function messageRowsForConversations(db: ReturnType<typeof admin>, ids: string[]) {
  const rows: MessageRow[] = []
  for (let start = 0; start < ids.length; start += 500) {
    const { data, error } = await db
      .from('messages')
      .select('conversation_id, sender_type, created_at')
      .in('conversation_id', ids.slice(start, start + 500))
      .order('created_at', { ascending: true })
    if (error) throw error
    rows.push(...(data as MessageRow[] ?? []))
  }
  return rows
}

/** The full executive report aggregation — shared by GET /api/reports/executive
 *  and the AI dictamen route, so both always see byte-identical numbers
 *  computed in-process (no self-fetch, no risk of the app failing to reach
 *  its own base URL depending on how it's deployed/proxied). */
export async function buildExecutiveReport(accountId: string, range: ExecutiveReportRange) {
  const db = admin()

  const [accountResult, conversationResult, previousConversationResult, backlogResult, resolvedResult, profilesResult, openConversationsResult, analysesResult, dealsResult, openDealsResult, broadcastsResult, contactMemoryResult, contactObjectionsResult, overdueCommitmentsResult, appointmentsResult] = await Promise.all([
    db.from('accounts').select('operating_mode, default_currency').eq('id', accountId).single(),
    db.from('conversations').select('id, assigned_agent_id, status, channel_type, created_at').eq('account_id', accountId).gte('created_at', range.from).lt('created_at', range.toExclusive).order('created_at'),
    db.from('conversations').select('*', { count: 'exact', head: true }).eq('account_id', accountId).gte('created_at', range.previousFrom).lt('created_at', range.previousToExclusive),
    db.from('conversations').select('*', { count: 'exact', head: true }).eq('account_id', accountId).in('status', ['open', 'pending']),
    db.from('conversations').select('id, assigned_agent_id, status, channel_type, created_at').eq('account_id', accountId).eq('status', 'closed').gte('updated_at', range.from).lt('updated_at', range.toExclusive),
    db.from('profiles').select('user_id, full_name').eq('account_id', accountId).order('full_name'),
    db.from('conversations').select('assigned_agent_id').eq('account_id', accountId).in('status', ['open', 'pending']),
    db.from('ai_conversation_analyses').select('conversation_id, sentiment, sentiment_score, qa_score').eq('account_id', accountId).eq('status', 'completed').gte('analyzed_at', range.from).lt('analyzed_at', range.toExclusive),
    db.from('deals').select('value, status, updated_at, source_broadcast_id, source_channel, stage:pipeline_stages(name, position)').eq('account_id', accountId).gte('updated_at', range.from).lt('updated_at', range.toExclusive),
    db.from('deals').select('value').eq('account_id', accountId).eq('status', 'open'),
    db.from('broadcasts').select('id, name, template_name, status, created_at, total_recipients, sent_count, delivered_count, read_count, replied_count, failed_count').eq('account_id', accountId).gte('created_at', range.from).lt('created_at', range.toExclusive).order('created_at', { ascending: false }).limit(12),
    // Nexo Memory is a live snapshot ("current state of the relationship"),
    // not date-ranged like the rest of this report — a contact's risk
    // doesn't reset just because the report window changed.
    db.from('contact_memory').select('risk_level, opportunity_score').eq('account_id', accountId),
    db.from('contact_facts').select('fact').eq('account_id', accountId).eq('category', 'objection').eq('status', 'active').limit(2_000),
    db.from('contact_commitments').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('status', 'overdue'),
    // Appointments are date-ranged by created_at (when the booking
    // happened), not starts_at (when it's scheduled for) — that's what
    // "conversion in this period" and "cancellation rate this period" mean.
    db.from('appointments').select('status, contact_id, created_at').eq('account_id', accountId).gte('created_at', range.from).lt('created_at', range.toExclusive),
  ])

  for (const result of [accountResult, conversationResult, previousConversationResult, backlogResult, resolvedResult, profilesResult, openConversationsResult, analysesResult, dealsResult, openDealsResult, broadcastsResult, contactMemoryResult, contactObjectionsResult, overdueCommitmentsResult, appointmentsResult]) {
    if (result.error) throw result.error
  }

  const conversations = (conversationResult.data ?? []) as ConversationRow[]
  const measuredConversations = conversations.slice(0, MAX_CONVERSATIONS_FOR_RESPONSE_METRICS)
  const messages = await messageRowsForConversations(db, measuredConversations.map((row) => row.id))
  const messagesByConversation = new Map<string, MessageRow[]>()
  for (const message of messages) {
    const list = messagesByConversation.get(message.conversation_id) ?? []
    list.push(message)
    messagesByConversation.set(message.conversation_id, list)
  }

  const responseMinutesByConversation = new Map<string, number>()
  for (const conversation of measuredConversations) {
    const list = messagesByConversation.get(conversation.id) ?? []
    const firstCustomer = list.find((item) => item.sender_type === 'customer')
    if (!firstCustomer) continue
    const firstTeamReply = list.find((item) => item.created_at > firstCustomer.created_at && item.sender_type !== 'customer')
    if (!firstTeamReply) continue
    responseMinutesByConversation.set(conversation.id, Math.max(0, Math.round((new Date(firstTeamReply.created_at).getTime() - new Date(firstCustomer.created_at).getTime()) / 60_000)))
  }
  const responseValues = [...responseMinutesByConversation.values()]
  const firstResponseMinutes = responseValues.length ? Math.round(responseValues.reduce((sum, item) => sum + item, 0) / responseValues.length) : null

  const channelMap = new Map<string, { conversations: number; closed: number; responseTotal: number; responseCount: number }>()
  for (const conversation of conversations) {
    const channel = channelTypeLabel(conversation.channel_type)
    const current = channelMap.get(channel) ?? { conversations: 0, closed: 0, responseTotal: 0, responseCount: 0 }
    current.conversations += 1
    const response = responseMinutesByConversation.get(conversation.id)
    if (response !== undefined) { current.responseTotal += response; current.responseCount += 1 }
    channelMap.set(channel, current)
  }
  for (const conversation of (resolvedResult.data ?? []) as ConversationRow[]) {
    const channel = channelTypeLabel(conversation.channel_type)
    const current = channelMap.get(channel) ?? { conversations: 0, closed: 0, responseTotal: 0, responseCount: 0 }
    current.closed += 1
    channelMap.set(channel, current)
  }

  const openByAgent = new Map<string, number>()
  for (const conversation of openConversationsResult.data ?? []) {
    if (!conversation.assigned_agent_id) continue
    openByAgent.set(conversation.assigned_agent_id, (openByAgent.get(conversation.assigned_agent_id) ?? 0) + 1)
  }
  const responseByAgent = new Map<string, number[]>()
  for (const conversation of conversations) {
    if (!conversation.assigned_agent_id) continue
    const response = responseMinutesByConversation.get(conversation.id)
    if (response === undefined) continue
    const list = responseByAgent.get(conversation.assigned_agent_id) ?? []
    list.push(response)
    responseByAgent.set(conversation.assigned_agent_id, list)
  }
  const analyses = (analysesResult.data ?? []) as AnalysisRow[]
  const sentimentScores = analyses.map((row) => row.sentiment_score).filter((value): value is number => typeof value === 'number')
  const qaScores = analyses.map((row) => row.qa_score).filter((value): value is number => typeof value === 'number')
  const negative = analyses.filter((row) => row.sentiment === 'negative').length

  // Analyses are ranged by analyzed_at, which can fall outside the
  // conversations already fetched above (ranged by created_at) — look up
  // the owning agent for exactly the conversations these analyses touch.
  const analysisConversationIds = [...new Set(analyses.map((row) => row.conversation_id))]
  const agentByAnalysisConversation = new Map<string, string | null>()
  for (let start = 0; start < analysisConversationIds.length; start += 500) {
    const { data, error } = await db.from('conversations').select('id, assigned_agent_id').eq('account_id', accountId).in('id', analysisConversationIds.slice(start, start + 500))
    if (error) throw error
    for (const row of data ?? []) agentByAnalysisConversation.set(row.id, row.assigned_agent_id)
  }
  const qaByAgent = new Map<string, number[]>()
  for (const row of analyses) {
    if (typeof row.qa_score !== 'number') continue
    const agentId = agentByAnalysisConversation.get(row.conversation_id)
    if (!agentId) continue
    const list = qaByAgent.get(agentId) ?? []
    list.push(row.qa_score)
    qaByAgent.set(agentId, list)
  }

  const agents = (profilesResult.data ?? []).map((profile) => {
    const responses = responseByAgent.get(profile.user_id) ?? []
    const qaScoresForAgent = qaByAgent.get(profile.user_id) ?? []
    return {
      id: profile.user_id,
      name: profile.full_name || 'Agente sin nombre',
      open_conversations: openByAgent.get(profile.user_id) ?? 0,
      first_response_minutes: responses.length ? Math.round(responses.reduce((sum, item) => sum + item, 0) / responses.length) : null,
      measured_responses: responses.length,
      average_qa_score: qaScoresForAgent.length ? Math.round(qaScoresForAgent.reduce((sum, item) => sum + item, 0) / qaScoresForAgent.length) : null,
    }
  }).sort((a, b) => b.open_conversations - a.open_conversations || a.name.localeCompare(b.name))

  const deals = (dealsResult.data ?? []) as DealRow[]
  const wonDeals = deals.filter((row) => row.status === 'won')
  const lostDeals = deals.filter((row) => row.status === 'lost')
  const commercialByChannel = new Map<string, { channel: string; deals: number; won_deals: number; lost_deals: number; open_deals: number; pipeline_value: number; won_value: number }>()
  const funnelByStage = new Map<string, { stage: string; position: number; deals: number; won_deals: number; lost_deals: number; open_deals: number; value: number; won_value: number }>()
  for (const deal of deals) {
    const channel = dealChannelLabel(deal.source_channel)
    const channelCurrent = commercialByChannel.get(channel) ?? { channel, deals: 0, won_deals: 0, lost_deals: 0, open_deals: 0, pipeline_value: 0, won_value: 0 }
    channelCurrent.deals += 1
    channelCurrent.pipeline_value += numeric(deal.value)
    if (deal.status === 'won') { channelCurrent.won_deals += 1; channelCurrent.won_value += numeric(deal.value) }
    if (deal.status === 'lost') channelCurrent.lost_deals += 1
    if (deal.status === 'open') channelCurrent.open_deals += 1
    commercialByChannel.set(channel, channelCurrent)

    const stageValue = Array.isArray(deal.stage) ? deal.stage[0] : deal.stage
    const stage = stageValue?.name || 'Sin etapa'
    const stageCurrent = funnelByStage.get(stage) ?? { stage, position: stageValue?.position ?? Number.MAX_SAFE_INTEGER, deals: 0, won_deals: 0, lost_deals: 0, open_deals: 0, value: 0, won_value: 0 }
    stageCurrent.deals += 1
    stageCurrent.value += numeric(deal.value)
    if (deal.status === 'won') { stageCurrent.won_deals += 1; stageCurrent.won_value += numeric(deal.value) }
    if (deal.status === 'lost') stageCurrent.lost_deals += 1
    if (deal.status === 'open') stageCurrent.open_deals += 1
    funnelByStage.set(stage, stageCurrent)
  }
  const broadcasts = (broadcastsResult.data ?? []) as BroadcastRow[]
  const attributedBroadcastIds = [...new Set(deals.map((deal) => deal.source_broadcast_id).filter((id): id is string => Boolean(id)))]
  const attributedBroadcastsResult = attributedBroadcastIds.length
    ? await db.from('broadcasts').select('id, name, template_name, status, created_at, total_recipients, sent_count, delivered_count, read_count, replied_count, failed_count').eq('account_id', accountId).in('id', attributedBroadcastIds)
    : { data: [] as BroadcastRow[], error: null }
  if (attributedBroadcastsResult.error) throw attributedBroadcastsResult.error
  const reportBroadcasts = new Map<string, BroadcastRow>()
  for (const broadcast of [...broadcasts, ...((attributedBroadcastsResult.data ?? []) as BroadcastRow[])]) reportBroadcasts.set(broadcast.id, broadcast)
  const attributionByBroadcast = new Map<string, { deals: number; won_deals: number; won_value: number; pipeline_value: number }>()
  for (const deal of deals) {
    if (!deal.source_broadcast_id) continue
    const current = attributionByBroadcast.get(deal.source_broadcast_id) ?? { deals: 0, won_deals: 0, won_value: 0, pipeline_value: 0 }
    current.deals += 1
    current.pipeline_value += numeric(deal.value)
    if (deal.status === 'won') {
      current.won_deals += 1
      current.won_value += numeric(deal.value)
    }
    attributionByBroadcast.set(deal.source_broadcast_id, current)
  }
  const campaignTotals = broadcasts.reduce((totals, campaign) => ({
    recipients: totals.recipients + (campaign.total_recipients ?? 0),
    sent: totals.sent + (campaign.sent_count ?? 0),
    delivered: totals.delivered + (campaign.delivered_count ?? 0),
    read: totals.read + (campaign.read_count ?? 0),
    replied: totals.replied + (campaign.replied_count ?? 0),
    failed: totals.failed + (campaign.failed_count ?? 0),
  }), { recipients: 0, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0 })

  const account = accountResult.data
  if (!account) throw new Error('Account not found')
  const mode = (account.operating_mode === 'commercial' || account.operating_mode === 'support' || account.operating_mode === 'hybrid' ? account.operating_mode : 'hybrid') as OperatingMode

  const memoryRows = (contactMemoryResult.data ?? []) as Array<{ risk_level: string | null; opportunity_score: number | null }>
  const opportunityScores = memoryRows.map((row) => row.opportunity_score).filter((value): value is number => typeof value === 'number')
  const objectionCounts = new Map<string, number>()
  for (const row of (contactObjectionsResult.data ?? []) as Array<{ fact: string }>) {
    objectionCounts.set(row.fact, (objectionCounts.get(row.fact) ?? 0) + 1)
  }

  const appointments = (appointmentsResult.data ?? []) as AppointmentRow[]
  const appointmentContactIds = [...new Set(appointments.map((row) => row.contact_id).filter((id): id is string => Boolean(id)))]
  // Approximation, not a strict "conversation happened before the booking"
  // ordering: a contact who has ever messaged in is credited as an
  // appointment that came from a conversation rather than a walk-in/manual
  // booking. Good enough to spot the trend without an expensive per-row join.
  const { data: contactsWithConversations, error: contactsWithConversationsError } = appointmentContactIds.length
    ? await db.from('conversations').select('contact_id').eq('account_id', accountId).in('contact_id', appointmentContactIds)
    : { data: [] as { contact_id: string }[], error: null }
  if (contactsWithConversationsError) throw contactsWithConversationsError
  const contactIdsWithConversation = new Set((contactsWithConversations ?? []).map((row) => row.contact_id))
  const appointmentsFromConversation = appointments.filter((row) => row.contact_id && contactIdsWithConversation.has(row.contact_id)).length
  const appointmentsByStatus = (status: string) => appointments.filter((row) => row.status === status).length

  return {
    meta: {
      operating_mode: mode,
      currency: account.default_currency ?? 'USD',
      range: { from: range.fromDate, to: range.toDate, days: range.dayCount },
      response_metrics_capped: conversations.length > MAX_CONVERSATIONS_FOR_RESPONSE_METRICS,
    },
    operational: {
      new_conversations: conversations.length,
      previous_new_conversations: previousConversationResult.count ?? 0,
      open_backlog: backlogResult.count ?? 0,
      resolved: (resolvedResult.data ?? []).length,
      first_response_minutes: firstResponseMinutes,
      first_response_samples: responseValues.length,
    },
    channels: [...channelMap.entries()].map(([channel, data]) => ({
      channel,
      conversations: data.conversations,
      resolved: data.closed,
      first_response_minutes: data.responseCount ? Math.round(data.responseTotal / data.responseCount) : null,
    })).sort((a, b) => b.conversations - a.conversations),
    agents,
    intelligence: {
      analyzed: analyses.length,
      negative,
      negative_rate: percentage(negative, analyses.length),
      average_sentiment_score: sentimentScores.length ? Math.round(sentimentScores.reduce((sum, value) => sum + value, 0) / sentimentScores.length) : null,
      average_qa_score: qaScores.length ? Math.round(qaScores.reduce((sum, value) => sum + value, 0) / qaScores.length) : null,
    },
    commercial: {
      open_pipeline_value: (openDealsResult.data ?? []).reduce((sum, deal) => sum + numeric(deal.value), 0),
      open_deals: (openDealsResult.data ?? []).length,
      won_deals: wonDeals.length,
      lost_deals: lostDeals.length,
      won_value: wonDeals.reduce((sum, deal) => sum + numeric(deal.value), 0),
      attributed_deals: [...attributionByBroadcast.values()].reduce((sum, item) => sum + item.deals, 0),
      attributed_won_deals: [...attributionByBroadcast.values()].reduce((sum, item) => sum + item.won_deals, 0),
      attributed_won_value: [...attributionByBroadcast.values()].reduce((sum, item) => sum + item.won_value, 0),
      source_channels: [...commercialByChannel.values()].sort((a, b) => b.won_value - a.won_value || b.deals - a.deals || a.channel.localeCompare(b.channel)),
    },
    funnel: [...funnelByStage.values()].sort((a, b) => a.position - b.position || a.stage.localeCompare(b.stage)),
    campaigns: {
      totals: campaignTotals,
      delivery_rate: percentage(campaignTotals.delivered, campaignTotals.sent),
      read_rate: percentage(campaignTotals.read, campaignTotals.delivered),
      reply_rate: percentage(campaignTotals.replied, campaignTotals.delivered),
      items: [...reportBroadcasts.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((campaign) => ({
        ...campaign,
        delivery_rate: percentage(numeric(campaign.delivered_count), numeric(campaign.sent_count)),
        read_rate: percentage(numeric(campaign.read_count), numeric(campaign.delivered_count)),
        reply_rate: percentage(numeric(campaign.replied_count), numeric(campaign.delivered_count)),
        attributed_deals: attributionByBroadcast.get(campaign.id)?.deals ?? 0,
        attributed_won_deals: attributionByBroadcast.get(campaign.id)?.won_deals ?? 0,
        attributed_won_value: attributionByBroadcast.get(campaign.id)?.won_value ?? 0,
        attributed_pipeline_value: attributionByBroadcast.get(campaign.id)?.pipeline_value ?? 0,
      })),
    },
    nexo_memory: {
      contacts_with_memory: memoryRows.length,
      high_risk_count: memoryRows.filter((row) => row.risk_level === 'high').length,
      medium_risk_count: memoryRows.filter((row) => row.risk_level === 'medium').length,
      low_risk_count: memoryRows.filter((row) => row.risk_level === 'low').length,
      average_opportunity_score: opportunityScores.length ? Math.round(opportunityScores.reduce((sum, value) => sum + value, 0) / opportunityScores.length) : null,
      overdue_commitments: overdueCommitmentsResult.count ?? 0,
      top_objections: [...objectionCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([objection, count]) => ({ objection, count })),
    },
    appointments: {
      total: appointments.length,
      scheduled: appointmentsByStatus('scheduled'),
      confirmed: appointmentsByStatus('confirmed'),
      completed: appointmentsByStatus('completed'),
      cancelled: appointmentsByStatus('cancelled'),
      no_show: appointmentsByStatus('no_show'),
      confirmation_rate: percentage(appointmentsByStatus('confirmed') + appointmentsByStatus('completed'), appointments.length),
      cancellation_rate: percentage(appointmentsByStatus('cancelled'), appointments.length),
      no_show_rate: percentage(appointmentsByStatus('no_show'), appointments.length),
      occupancy_rate: percentage(appointmentsByStatus('completed'), appointments.length),
      conversion_rate: percentage(appointmentsFromConversation, appointments.length),
    },
  }
}
