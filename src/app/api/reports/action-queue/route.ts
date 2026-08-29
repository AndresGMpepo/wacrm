import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'

export const dynamic = 'force-dynamic'

type Contact = { name: string | null; phone: string | null } | null
type ContactRelation = Contact | Contact[]

function contactOf(value: ContactRelation) {
  return Array.isArray(value) ? value[0] ?? null : value
}

function contactName(contact: ContactRelation) {
  const value = contactOf(contact)
  return value?.name || value?.phone || 'Contacto sin nombre'
}

function nestedContact(value: unknown): ContactRelation {
  const relation = Array.isArray(value) ? value[0] : value
  if (!relation || typeof relation !== 'object') return null
  return (relation as { contact?: ContactRelation }).contact ?? null
}

/**
 * The executive report is intentionally aggregate. This small companion
 * endpoint provides the actual open records behind its most important
 * signals, without running AI or changing the operation.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const staleBefore = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const [analysesResult, followUpsResult, dealsResult, overdueCommitmentsResult, highRiskResult] = await Promise.all([
      supabase
        .from('ai_conversation_analyses')
        .select('conversation_id, sentiment_score, qa_score, next_best_action, updated_at')
        .eq('account_id', accountId)
        .eq('status', 'completed')
        .eq('sentiment', 'negative')
        .order('updated_at', { ascending: false })
        .limit(100),
      supabase
        .from('call_follow_up_tasks')
        .select('id, conversation_id, due_at, created_at, conversation:conversations(contact:contacts(name, phone))')
        .eq('account_id', accountId)
        .eq('status', 'pending')
        .lte('due_at', new Date().toISOString())
        .order('due_at', { ascending: true })
        .limit(8),
      supabase
        .from('deals')
        .select('id, title, value, currency, expected_close_date, updated_at, contact:contacts(name, phone), stage:pipeline_stages(name)')
        .eq('account_id', accountId)
        .eq('status', 'open')
        .lt('updated_at', staleBefore)
        .order('updated_at', { ascending: true })
        .limit(8),
      supabase
        .from('contact_commitments')
        .select('id, description, owner, due_date, contact:contacts(name, phone)')
        .eq('account_id', accountId)
        .eq('status', 'overdue')
        .order('due_date', { ascending: true })
        .limit(8),
      supabase
        .from('contact_memory')
        .select('contact_id, risk_level, opportunity_score, next_best_action, updated_at, contact:contacts(name, phone)')
        .eq('account_id', accountId)
        .eq('risk_level', 'high')
        .order('updated_at', { ascending: false })
        .limit(8),
    ])
    if (analysesResult.error) throw analysesResult.error
    if (followUpsResult.error) throw followUpsResult.error
    if (dealsResult.error) throw dealsResult.error
    if (overdueCommitmentsResult.error) throw overdueCommitmentsResult.error
    if (highRiskResult.error) throw highRiskResult.error

    // A conversation may have many historical negative analyses. One latest
    // item is enough for action and prevents duplicate cards in the queue.
    const latestByConversation = new Map<string, {
      sentiment_score: number | null
      qa_score: number | null
      next_best_action: string | null
      updated_at: string
    }>()
    for (const item of analysesResult.data ?? []) {
      if (!latestByConversation.has(item.conversation_id)) latestByConversation.set(item.conversation_id, item)
    }
    const criticalIds = [...latestByConversation.keys()]
    const conversationsResult = criticalIds.length
      ? await supabase
        .from('conversations')
        .select('id, status, contacts(name, phone)')
        .eq('account_id', accountId)
        .in('id', criticalIds)
      : { data: [], error: null }
    if (conversationsResult.error) throw conversationsResult.error

    const critical = (conversationsResult.data ?? [])
      .filter((conversation) => conversation.status !== 'closed')
      .map((conversation) => {
        const analysis = latestByConversation.get(conversation.id)!
        return {
          conversation_id: conversation.id,
          contact_name: contactName(conversation.contacts as ContactRelation),
          sentiment_score: analysis.sentiment_score,
          qa_score: analysis.qa_score,
          next_best_action: analysis.next_best_action,
          analyzed_at: analysis.updated_at,
        }
      })
      .sort((a, b) => new Date(b.analyzed_at).getTime() - new Date(a.analyzed_at).getTime())
      .slice(0, 8)

    return NextResponse.json({
      refreshed_at: new Date().toISOString(),
      critical,
      overdue_follow_ups: (followUpsResult.data ?? []).map((task) => ({
        id: task.id,
        conversation_id: task.conversation_id,
        contact_name: contactName(nestedContact(task.conversation)),
        due_at: task.due_at,
        created_at: task.created_at,
      })),
      stalled_deals: (dealsResult.data ?? []).map((deal) => ({
        id: deal.id,
        title: deal.title,
        contact_name: contactName(deal.contact as ContactRelation),
        value: Number(deal.value ?? 0),
        currency: deal.currency ?? 'USD',
        expected_close_date: deal.expected_close_date,
        updated_at: deal.updated_at,
        stage_name: contactName(deal.stage as unknown as ContactRelation),
      })),
      overdue_commitments: (overdueCommitmentsResult.data ?? []).map((commitment) => ({
        id: commitment.id,
        contact_name: contactName(commitment.contact as ContactRelation),
        description: commitment.description,
        owner: commitment.owner,
        due_date: commitment.due_date,
      })),
      high_risk_contacts: (highRiskResult.data ?? []).map((memory) => ({
        contact_id: memory.contact_id,
        contact_name: contactName(memory.contact as ContactRelation),
        opportunity_score: memory.opportunity_score,
        next_best_action: memory.next_best_action,
        updated_at: memory.updated_at,
      })),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
