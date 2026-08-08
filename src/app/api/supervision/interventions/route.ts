import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

export const dynamic = 'force-dynamic'

type Contact = { name: string | null; phone: string | null } | null
type Conversation = { id: string; status: string; assigned_agent_id: string | null; contacts: Contact | Contact[] }

function contactOf(value: Conversation['contacts']): Contact {
  return Array.isArray(value) ? value[0] ?? null : value
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { data: analyses, error: analysesError } = await supabase
      .from('ai_conversation_analyses')
      .select('conversation_id, sentiment_score, next_best_action, updated_at')
      .eq('account_id', accountId)
      .eq('status', 'completed')
      .eq('sentiment', 'negative')
      .order('updated_at', { ascending: false })
      .limit(100)
    if (analysesError) throw analysesError

    const latest = new Map<string, { sentiment_score: number | null; next_best_action: string | null; updated_at: string }>()
    for (const analysis of analyses ?? []) {
      if (!latest.has(analysis.conversation_id)) latest.set(analysis.conversation_id, analysis)
    }
    const ids = [...latest.keys()]
    if (!ids.length) return NextResponse.json({ items: [], refreshed_at: new Date().toISOString() })

    const [conversationsResult, interventionsResult] = await Promise.all([
      supabase.from('conversations').select('id, status, assigned_agent_id, contacts(name, phone)').in('id', ids),
      supabase.from('supervision_interventions').select('conversation_id, status, started_by_user_id, started_at, resolved_at').eq('account_id', accountId).in('conversation_id', ids),
    ])
    if (conversationsResult.error) throw conversationsResult.error
    if (interventionsResult.error) throw interventionsResult.error

    const interventionByConversation = new Map((interventionsResult.data ?? []).map((row) => [row.conversation_id, row]))
    const items = (conversationsResult.data ?? [])
      .map((row) => row as Conversation)
      .filter((conversation) => conversation.status !== 'closed')
      .map((conversation) => {
        const analysis = latest.get(conversation.id)!
        const contact = contactOf(conversation.contacts)
        const intervention = interventionByConversation.get(conversation.id)
        // Resolving closes the conversation. If an agent or customer reopens
        // it later, the prior resolution is historical only: it re-enters the
        // live queue as pending and needs a new supervisor decision.
        const interventionStatus = intervention?.status === 'resolved' ? 'pending' : intervention?.status ?? 'pending'
        return {
          conversation_id: conversation.id,
          contact_name: contact?.name || contact?.phone || 'Contacto sin nombre',
          assigned_agent_id: conversation.assigned_agent_id,
          sentiment_score: analysis.sentiment_score,
          next_best_action: analysis.next_best_action,
          analyzed_at: analysis.updated_at,
          intervention_status: interventionStatus,
          started_by_user_id: intervention?.started_by_user_id ?? null,
          started_at: intervention?.started_at ?? null,
          resolved_at: intervention?.resolved_at ?? null,
        }
      })
      .sort((a, b) => new Date(b.analyzed_at).getTime() - new Date(a.analyzed_at).getTime())

    return NextResponse.json({ items, refreshed_at: new Date().toISOString() })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : ''
    const action = body?.action === 'claim' || body?.action === 'resolve' ? body.action : null
    if (!conversationId || !action) return NextResponse.json({ error: 'Solicitud de intervención inválida.' }, { status: 400 })

    const { data: conversation, error: conversationError } = await supabase
      .from('conversations').select('id, status').eq('id', conversationId).eq('account_id', accountId).maybeSingle()
    if (conversationError) throw conversationError
    if (!conversation || conversation.status === 'closed') return NextResponse.json({ error: 'La conversación ya no está disponible para seguimiento.' }, { status: 409 })

    const { data: critical, error: criticalError } = await supabase
      .from('ai_conversation_analyses').select('id').eq('account_id', accountId).eq('conversation_id', conversationId).eq('status', 'completed').eq('sentiment', 'negative').limit(1)
    if (criticalError) throw criticalError
    if (!critical?.length) return NextResponse.json({ error: 'La conversación ya no tiene una alerta crítica vigente.' }, { status: 409 })

    const { data: current, error: currentError } = await supabase
      .from('supervision_interventions').select('id, status, started_by_user_id').eq('account_id', accountId).eq('conversation_id', conversationId).maybeSingle()
    if (currentError) throw currentError

    if (action === 'claim') {
      if (current?.status === 'in_progress' && current.started_by_user_id !== userId) {
        return NextResponse.json({ error: 'Otro supervisor ya tomó este seguimiento.' }, { status: 409 })
      }
      // Taking an intervention has an operational effect, not only an audit
      // effect: the responsible supervisor becomes the conversation owner.
      const { error: assignmentError } = await supabase
        .from('conversations')
        .update({ assigned_agent_id: userId, status: 'open' })
        .eq('id', conversationId)
        .eq('account_id', accountId)
      if (assignmentError) throw assignmentError
      const payload = { account_id: accountId, conversation_id: conversationId, status: 'in_progress', started_by_user_id: userId, started_at: new Date().toISOString(), resolved_by_user_id: null, resolved_at: null, updated_at: new Date().toISOString() }
      const { error } = current
        ? await supabase.from('supervision_interventions').update(payload).eq('id', current.id)
        : await supabase.from('supervision_interventions').insert(payload)
      if (error) throw error
      if (!current || current.status === 'resolved') {
        await supabase.from('conversation_internal_notes').insert({ account_id: accountId, conversation_id: conversationId, author_user_id: userId, body: 'Seguimiento de supervisión iniciado para una alerta de sentimiento negativo.', kind: 'note' })
      }
    } else {
      if (!current || current.status !== 'in_progress') return NextResponse.json({ error: 'No existe un seguimiento activo para resolver.' }, { status: 409 })
      // A resolved intervention closes the CRM conversation. The customer is
      // never messaged by this action; it simply removes the case from open
      // operational queues and records who resolved it.
      const { error: closeError } = await supabase
        .from('conversations')
        .update({ assigned_agent_id: userId, status: 'closed' })
        .eq('id', conversationId)
        .eq('account_id', accountId)
      if (closeError) throw closeError
      const { error } = await supabase.from('supervision_interventions').update({ status: 'resolved', resolved_by_user_id: userId, resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', current.id)
      if (error) throw error
      await supabase.from('conversation_internal_notes').insert({ account_id: accountId, conversation_id: conversationId, author_user_id: userId, body: 'Seguimiento de supervisión marcado como resuelto.', kind: 'note' })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
