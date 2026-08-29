import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId } = await requireRole('viewer');
    const { id: contactId } = await params;
    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (contactError) throw contactError;
    if (!contact)
      return NextResponse.json({ error: 'El contacto no existe.' }, { status: 404 });

    const [memoryResult, eventsResult, factsResult, commitmentsResult] =
      await Promise.all([
        supabase
          .from('contact_memory')
          .select(
            'current_summary, current_stage, sentiment, sentiment_score, risk_level, opportunity_score, next_best_action, updated_at'
          )
          .eq('contact_id', contactId)
          .maybeSingle(),
        supabase
          .from('contact_memory_events')
          .select('id, event_type, summary, importance, confidence, event_date')
          .eq('contact_id', contactId)
          .order('event_date', { ascending: false })
          .limit(20),
        supabase
          .from('contact_facts')
          .select('id, category, fact, confidence, status')
          .eq('contact_id', contactId)
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(30),
        supabase
          .from('contact_commitments')
          .select('id, description, owner, due_date, status, created_at')
          .eq('contact_id', contactId)
          .order('status', { ascending: true })
          .order('due_date', { ascending: true, nullsFirst: false })
          .limit(30),
      ]);
    if (memoryResult.error) throw memoryResult.error;
    if (eventsResult.error) throw eventsResult.error;
    if (factsResult.error) throw factsResult.error;
    if (commitmentsResult.error) throw commitmentsResult.error;

    return NextResponse.json({
      memory: memoryResult.data ?? null,
      events: eventsResult.data ?? [],
      facts: factsResult.data ?? [],
      commitments: commitmentsResult.data ?? [],
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
