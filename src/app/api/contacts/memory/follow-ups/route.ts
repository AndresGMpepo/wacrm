import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

export const dynamic = 'force-dynamic';

type Contact = { name: string | null; phone: string | null } | null;
type ContactRelation = Contact | Contact[];

function contactName(value: ContactRelation) {
  const contact = Array.isArray(value) ? (value[0] ?? null) : value;
  return contact?.name || contact?.phone || 'Contacto sin nombre';
}

/**
 * Nexo Memory's own follow-up queue — same kind of signal as the call
 * no-reply tasks, but open to any account member (not just admins) since
 * agents are the ones who actually work these follow-ups day to day.
 */
export async function GET() {
  try {
    const { supabase, accountId, userId, role } = await requireRole('viewer');
    const staleBefore = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    // contact_commitments/contact_memory are per-contact, not per-conversation
    // — a plain agent (REQ-02) only sees contacts whose conversation is
    // assigned to them or still unassigned; owners/admins/supervisors see
    // everything, unrestricted.
    let allowedContactIds: Set<string> | null = null;
    if (role === 'agent') {
      const { data: convRows, error: convError } = await supabase
        .from('conversations')
        .select('contact_id')
        .eq('account_id', accountId)
        .or(`assigned_agent_id.is.null,assigned_agent_id.eq.${userId}`);
      if (convError) throw convError;
      allowedContactIds = new Set((convRows ?? []).map((row) => row.contact_id).filter(Boolean) as string[]);
    }
    const isAllowed = (contactId: string | null) => !allowedContactIds || (contactId ? allowedContactIds.has(contactId) : false);

    const [overdueResult, highRiskResult, staleResult] = await Promise.all([
      supabase
        .from('contact_commitments')
        .select('id, contact_id, description, owner, due_date, contact:contacts(name, phone)')
        .eq('account_id', accountId)
        .eq('status', 'overdue')
        .order('due_date', { ascending: true })
        .limit(20),
      supabase
        .from('contact_memory')
        .select('contact_id, opportunity_score, next_best_action, updated_at, contact:contacts(name, phone)')
        .eq('account_id', accountId)
        .eq('risk_level', 'high')
        .order('updated_at', { ascending: false })
        .limit(20),
      supabase
        .from('contact_memory')
        .select('contact_id, current_stage, updated_at, contact:contacts(name, phone)')
        .eq('account_id', accountId)
        .in('risk_level', ['medium', 'high'])
        .lt('updated_at', staleBefore)
        .order('updated_at', { ascending: true })
        .limit(20),
    ]);
    if (overdueResult.error) throw overdueResult.error;
    if (highRiskResult.error) throw highRiskResult.error;
    if (staleResult.error) throw staleResult.error;

    return NextResponse.json({
      overdue_commitments: (overdueResult.data ?? [])
        .filter((item) => isAllowed(item.contact_id))
        .map((item) => ({
        id: item.id,
        contact_id: item.contact_id,
        contact_name: contactName(item.contact as ContactRelation),
        description: item.description,
        owner: item.owner,
        due_date: item.due_date,
      })),
      high_risk_contacts: (highRiskResult.data ?? [])
        .filter((item) => isAllowed(item.contact_id))
        .map((item) => ({
        contact_id: item.contact_id,
        contact_name: contactName(item.contact as ContactRelation),
        opportunity_score: item.opportunity_score,
        next_best_action: item.next_best_action,
        updated_at: item.updated_at,
      })),
      stale_prospects: (staleResult.data ?? [])
        .filter((item) => isAllowed(item.contact_id))
        .map((item) => ({
        contact_id: item.contact_id,
        contact_name: contactName(item.contact as ContactRelation),
        current_stage: item.current_stage,
        updated_at: item.updated_at,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
