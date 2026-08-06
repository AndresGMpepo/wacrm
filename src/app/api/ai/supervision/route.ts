import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

type ContactRow = { name: string | null; phone: string | null } | null
type ConversationRow = { id: string; status: string; contacts: ContactRow | ContactRow[] }

function firstContact(value: ConversationRow['contacts']): ContactRow {
  return Array.isArray(value) ? value[0] ?? null : value
}

/** Current negative conversations for the owner/admin supervision desk. */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { data: analyses, error: analysesError } = await supabase
      .from('ai_conversation_analyses')
      .select('conversation_id, sentiment, sentiment_score, qa_score, qa_summary, qa_findings, next_best_action, analyzed_at, updated_at')
      .eq('account_id', accountId)
      .eq('status', 'completed')
      .eq('sentiment', 'negative')
      .order('updated_at', { ascending: false })
      .limit(50)
    if (analysesError) throw analysesError

    const conversationIds = (analyses ?? []).map((analysis) => analysis.conversation_id)
    if (conversationIds.length === 0) {
      return NextResponse.json({ conversations: [], refreshed_at: new Date().toISOString() })
    }

    // Separate lookup rather than an embedded join: it stays resilient to a
    // stale PostgREST relationship cache after a migration.
    const { data: conversations, error: conversationsError } = await supabase
      .from('conversations')
      .select('id, status, contacts(name, phone)')
      .in('id', conversationIds)
    if (conversationsError) throw conversationsError
    const byId = new Map((conversations ?? []).map((row) => [row.id, row as ConversationRow]))

    return NextResponse.json({
      conversations: (analyses ?? []).flatMap((analysis) => {
        const conversation = byId.get(analysis.conversation_id)
        if (!conversation) return []
        const contact = firstContact(conversation.contacts)
        return [{
          ...analysis,
          status: conversation.status,
          contact_name: contact?.name || contact?.phone || 'Contacto sin nombre',
          contact_phone: contact?.phone || null,
        }]
      }),
      refreshed_at: new Date().toISOString(),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
