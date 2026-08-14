import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

export async function GET() {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const { data, error } = await supabase.from('call_follow_up_tasks')
      .select('id, conversation_id, assigned_agent_id, due_at, status, source, created_at, conversation:conversations(contact:contacts(name, phone))')
      .eq('account_id', accountId).eq('status', 'pending')
      .or(`assigned_agent_id.is.null,assigned_agent_id.eq.${userId}`)
      .order('due_at').limit(50)
    if (error) throw error
    const tasks = data ?? []
    const conversationIds = [...new Set(tasks.map((task) => task.conversation_id))]
    const { data: analyses, error: analysesError } = conversationIds.length
      ? await supabase.from('ai_conversation_analyses')
        .select('conversation_id, sentiment, sentiment_score, qa_score, next_best_action, analyzed_at')
        .eq('account_id', accountId).eq('source', 'whatsapp').eq('status', 'completed').in('conversation_id', conversationIds)
      : { data: [], error: null }
    if (analysesError) throw analysesError
    const analysisByConversation = new Map((analyses ?? []).map((analysis) => [analysis.conversation_id, analysis]))
    return NextResponse.json({ tasks: tasks.map((task) => ({ ...task, latest_analysis: analysisByConversation.get(task.conversation_id) ?? null })) })
  } catch (error) { return toErrorResponse(error) }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const body = await request.json().catch(() => null)
    const id = typeof body?.id === 'string' ? body.id : ''
    const status = body?.status === 'completed' || body?.status === 'cancelled' ? body.status : null
    const outcome = typeof body?.outcome === 'string' ? body.outcome.trim().slice(0, 1000) : null
    if (!id || !status) return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
    const { error } = await supabase.from('call_follow_up_tasks').update({ status, outcome, completed_at: new Date().toISOString() }).eq('id', id).eq('account_id', accountId).eq('status', 'pending')
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) { return toErrorResponse(error) }
}
