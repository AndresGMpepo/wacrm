import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { requireRole, toErrorResponse } from '@/lib/auth/account'

export const dynamic = 'force-dynamic'

type OperatingMode = 'commercial' | 'support' | 'hybrid'
type ConversationRow = {
  id: string
  assigned_agent_id: string | null
  status: string
  channel_type: string | null
  created_at: string
}
type MessageRow = { conversation_id: string; sender_type: string; created_at: string }
type AnalysisRow = { sentiment: string | null; sentiment_score: number | null; qa_score: number | null }
type DealRow = { value: number | string | null; status: string; updated_at: string }
type BroadcastRow = {
  id: string; name: string; status: string; created_at: string
  total_recipients: number | null; sent_count: number | null; delivered_count: number | null
  read_count: number | null; replied_count: number | null; failed_count: number | null
}

const MAX_RANGE_DAYS = 365
const MAX_CONVERSATIONS_FOR_RESPONSE_METRICS = 5_000

function admin() {
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

function parseRange(url: URL) {
  const today = new Date()
  const defaultEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const toStart = dayStart(url.searchParams.get('to') ?? '') ?? defaultEnd
  const fromStart = dayStart(url.searchParams.get('from') ?? '') ?? plusDays(toStart, -29)
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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const workerAllowed = Boolean(process.env.AI_ANALYSIS_WORKER_SECRET) && request.headers.get('x-report-worker-secret') === process.env.AI_ANALYSIS_WORKER_SECRET
    const ctx = workerAllowed ? null : await requireRole('admin')
    const accountId = workerAllowed ? url.searchParams.get('account_id') : ctx!.accountId
    if (!accountId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(accountId)) {
      return NextResponse.json({ error: 'Cuenta de reporte no válida.' }, { status: 400 })
    }
    const range = parseRange(url)
    const db = admin()

    const [accountResult, conversationResult, previousConversationResult, backlogResult, resolvedResult, profilesResult, openConversationsResult, analysesResult, dealsResult, openDealsResult, broadcastsResult] = await Promise.all([
      db.from('accounts').select('operating_mode, default_currency').eq('id', accountId).single(),
      db.from('conversations').select('id, assigned_agent_id, status, channel_type, created_at').eq('account_id', accountId).gte('created_at', range.from).lt('created_at', range.toExclusive).order('created_at'),
      db.from('conversations').select('*', { count: 'exact', head: true }).eq('account_id', accountId).gte('created_at', range.previousFrom).lt('created_at', range.previousToExclusive),
      db.from('conversations').select('*', { count: 'exact', head: true }).eq('account_id', accountId).in('status', ['open', 'pending']),
      db.from('conversations').select('id, assigned_agent_id, status, channel_type, created_at').eq('account_id', accountId).eq('status', 'closed').gte('updated_at', range.from).lt('updated_at', range.toExclusive),
      db.from('profiles').select('user_id, full_name').eq('account_id', accountId).order('full_name'),
      db.from('conversations').select('assigned_agent_id').eq('account_id', accountId).in('status', ['open', 'pending']),
      db.from('ai_conversation_analyses').select('sentiment, sentiment_score, qa_score').eq('account_id', accountId).eq('status', 'completed').gte('analyzed_at', range.from).lt('analyzed_at', range.toExclusive),
      db.from('deals').select('value, status, updated_at').eq('account_id', accountId).gte('updated_at', range.from).lt('updated_at', range.toExclusive),
      db.from('deals').select('value').eq('account_id', accountId).eq('status', 'open'),
      db.from('broadcasts').select('id, name, status, created_at, total_recipients, sent_count, delivered_count, read_count, replied_count, failed_count').eq('account_id', accountId).gte('created_at', range.from).lt('created_at', range.toExclusive).order('created_at', { ascending: false }).limit(12),
    ])

    for (const result of [accountResult, conversationResult, previousConversationResult, backlogResult, resolvedResult, profilesResult, openConversationsResult, analysesResult, dealsResult, openDealsResult, broadcastsResult]) {
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
      const channel = conversation.channel_type === 'yeastar_live_chat' ? 'Chat web Yeastar' : conversation.channel_type === 'whatsapp' || !conversation.channel_type ? 'WhatsApp' : conversation.channel_type
      const current = channelMap.get(channel) ?? { conversations: 0, closed: 0, responseTotal: 0, responseCount: 0 }
      current.conversations += 1
      const response = responseMinutesByConversation.get(conversation.id)
      if (response !== undefined) { current.responseTotal += response; current.responseCount += 1 }
      channelMap.set(channel, current)
    }
    for (const conversation of (resolvedResult.data ?? []) as ConversationRow[]) {
      const channel = conversation.channel_type === 'yeastar_live_chat' ? 'Chat web Yeastar' : conversation.channel_type === 'whatsapp' || !conversation.channel_type ? 'WhatsApp' : conversation.channel_type
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
    const agents = (profilesResult.data ?? []).map((profile) => {
      const responses = responseByAgent.get(profile.user_id) ?? []
      return {
        id: profile.user_id,
        name: profile.full_name || 'Agente sin nombre',
        open_conversations: openByAgent.get(profile.user_id) ?? 0,
        first_response_minutes: responses.length ? Math.round(responses.reduce((sum, item) => sum + item, 0) / responses.length) : null,
        measured_responses: responses.length,
      }
    }).sort((a, b) => b.open_conversations - a.open_conversations || a.name.localeCompare(b.name))

    const analyses = (analysesResult.data ?? []) as AnalysisRow[]
    const sentimentScores = analyses.map((row) => row.sentiment_score).filter((value): value is number => typeof value === 'number')
    const qaScores = analyses.map((row) => row.qa_score).filter((value): value is number => typeof value === 'number')
    const negative = analyses.filter((row) => row.sentiment === 'negative').length
    const deals = (dealsResult.data ?? []) as DealRow[]
    const wonDeals = deals.filter((row) => row.status === 'won')
    const lostDeals = deals.filter((row) => row.status === 'lost')
    const broadcasts = (broadcastsResult.data ?? []) as BroadcastRow[]
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
    return NextResponse.json({
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
      },
      campaigns: {
        totals: campaignTotals,
        delivery_rate: percentage(campaignTotals.delivered, campaignTotals.sent),
        read_rate: percentage(campaignTotals.read, campaignTotals.delivered),
        reply_rate: percentage(campaignTotals.replied, campaignTotals.delivered),
        items: broadcasts,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('El periodo')) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return toErrorResponse(error)
  }
}
