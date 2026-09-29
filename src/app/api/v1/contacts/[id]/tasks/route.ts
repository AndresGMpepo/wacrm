// ============================================================
// POST /api/v1/contacts/{id}/tasks — create a follow-up task
// (scope: contact-memory:write)
//
// Public-API counterpart of the dashboard's "Nueva tarea" dialog
// (src/app/api/contacts/tasks/route.ts) — same table
// (contact_commitments), same due_at-drives-the-10-minutes-before
// reminder behavior, just re-scoped to API-key auth and always
// attached to an EXISTING contact id (find-or-create a contact via
// `POST /api/v1/contacts` first if you only have a phone number).
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { resolveAuditUserId, ContactError } from '@/lib/api/v1/contacts';

const TASK_SELECT = 'id, contact_id, description, owner, due_date, due_at, status, created_at';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'contact-memory:write');
    const { id: contactId } = await params;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (!description || description.length > 300) {
      return fail('bad_request', "'description' must contain between 1 and 300 characters", 400);
    }

    const dueAtRaw = typeof body.due_at === 'string' ? new Date(body.due_at) : null;
    if (!dueAtRaw || Number.isNaN(dueAtRaw.getTime())) {
      return fail('bad_request', "'due_at' must be a valid ISO 8601 date-time", 400);
    }

    const owner = body.owner === 'customer' ? 'customer' : 'agent';

    const { data: contact, error: contactError } = await ctx.supabase
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (contactError) {
      console.error('[api/v1/contacts/tasks] contact read error:', contactError);
      return fail('internal', 'Failed to read contact', 500);
    }
    if (!contact) return fail('not_found', 'Contact not found', 404);

    let assignedAgentId: string;
    try {
      assignedAgentId = await resolveAuditUserId(ctx.supabase, ctx.accountId);
    } catch (err) {
      if (err instanceof ContactError) return fail('internal', err.message, err.status);
      throw err;
    }

    const { data: task, error: insertError } = await ctx.supabase
      .from('contact_commitments')
      .insert({
        account_id: ctx.accountId,
        contact_id: contactId,
        description,
        owner,
        due_date: dueAtRaw.toISOString().slice(0, 10),
        due_at: dueAtRaw.toISOString(),
        assigned_agent_id: assignedAgentId,
        source_type: 'manual',
      })
      .select(TASK_SELECT)
      .single();
    if (insertError) {
      console.error('[api/v1/contacts/tasks] insert error:', insertError);
      return fail('internal', 'Failed to create task', 500);
    }

    return ok(task, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
