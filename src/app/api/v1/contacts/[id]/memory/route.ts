// ============================================================
// GET /api/v1/contacts/{id}/memory — read a contact's Nexo Memory
//
// Scope: `contact-memory:read`. Read-only: an external caller (or an
// MCP tool) can ask "what do we know about this customer?" without
// gaining any ability to alter the underlying analysis, which is
// only ever written by the AI analysis worker or a dashboard admin.
// Mirrors the dashboard's own `GET /api/contacts/{id}/memory` (same
// four pieces: consolidated memory, timeline events, active facts,
// commitments/tasks), just re-scoped to API-key auth.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'contact-memory:read');
    const { id: contactId } = await params;

    const { data: contact, error: contactError } = await ctx.supabase
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (contactError) {
      console.error('[api/v1/contacts/memory] contact read error:', contactError);
      return fail('internal', 'Failed to read contact', 500);
    }
    if (!contact) return fail('not_found', 'Contact not found', 404);

    const [memoryResult, eventsResult, factsResult, commitmentsResult] =
      await Promise.all([
        ctx.supabase
          .from('contact_memory')
          .select(
            'current_summary, current_stage, sentiment, sentiment_score, risk_level, opportunity_score, next_best_action, updated_at'
          )
          .eq('contact_id', contactId)
          .maybeSingle(),
        ctx.supabase
          .from('contact_memory_events')
          .select('id, event_type, summary, importance, confidence, event_date')
          .eq('contact_id', contactId)
          .order('event_date', { ascending: false })
          .limit(20),
        ctx.supabase
          .from('contact_facts')
          .select('id, category, fact, confidence, status')
          .eq('contact_id', contactId)
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(30),
        ctx.supabase
          .from('contact_commitments')
          .select('id, description, owner, due_date, due_at, status, created_at')
          .eq('contact_id', contactId)
          .order('status', { ascending: true })
          .order('due_date', { ascending: true, nullsFirst: false })
          .limit(30),
      ]);
    if (memoryResult.error) {
      console.error('[api/v1/contacts/memory] memory read error:', memoryResult.error);
      return fail('internal', 'Failed to read contact memory', 500);
    }
    if (eventsResult.error) {
      console.error('[api/v1/contacts/memory] events read error:', eventsResult.error);
      return fail('internal', 'Failed to read contact memory events', 500);
    }
    if (factsResult.error) {
      console.error('[api/v1/contacts/memory] facts read error:', factsResult.error);
      return fail('internal', 'Failed to read contact facts', 500);
    }
    if (commitmentsResult.error) {
      console.error('[api/v1/contacts/memory] commitments read error:', commitmentsResult.error);
      return fail('internal', 'Failed to read contact commitments', 500);
    }

    return ok({
      memory: memoryResult.data ?? null,
      events: eventsResult.data ?? [],
      facts: factsResult.data ?? [],
      commitments: commitmentsResult.data ?? [],
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
