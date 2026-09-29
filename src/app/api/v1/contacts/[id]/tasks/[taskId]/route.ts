// ============================================================
// PATCH/DELETE /api/v1/contacts/{id}/tasks/{taskId}
// (scope: contact-memory:write)
//
// Public-API counterpart of the dashboard's task edit/delete routes
// (src/app/api/contacts/[id]/memory/commitments/[commitmentId]/route.ts).
// PATCH updates only the fields present in the body; editing due_at
// clears reminder_sent_at so the "10 minutes before" reminder fires
// again for the new time.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';

const STATUSES = ['pending', 'done', 'overdue', 'cancelled'] as const;
const TASK_SELECT = 'id, contact_id, description, owner, due_date, due_at, status, created_at';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'contact-memory:write');
    const { id: contactId, taskId } = await params;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const patch: Record<string, unknown> = {};

    if ('status' in body) {
      const status = typeof body.status === 'string' && (STATUSES as readonly string[]).includes(body.status)
        ? body.status
        : null;
      if (!status) return fail('bad_request', `'status' must be one of ${STATUSES.join(', ')}`, 400);
      patch.status = status;
    }

    if ('description' in body) {
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      if (!description || description.length > 300) {
        return fail('bad_request', "'description' must contain between 1 and 300 characters", 400);
      }
      patch.description = description;
    }

    if ('due_at' in body) {
      const dueAt = typeof body.due_at === 'string' ? new Date(body.due_at) : null;
      if (!dueAt || Number.isNaN(dueAt.getTime())) {
        return fail('bad_request', "'due_at' must be a valid ISO 8601 date-time", 400);
      }
      patch.due_at = dueAt.toISOString();
      patch.due_date = dueAt.toISOString().slice(0, 10);
      patch.reminder_sent_at = null;
    }

    if (Object.keys(patch).length === 0) {
      return fail('bad_request', 'Provide at least one field to update', 400);
    }

    const { data, error } = await ctx.supabase
      .from('contact_commitments')
      .update(patch)
      .eq('id', taskId)
      .eq('contact_id', contactId)
      .eq('account_id', ctx.accountId)
      .select(TASK_SELECT)
      .maybeSingle();
    if (error) {
      console.error('[api/v1/contacts/tasks] update error:', error);
      return fail('internal', 'Failed to update task', 500);
    }
    if (!data) return fail('not_found', 'Task not found', 404);

    return ok(data);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'contact-memory:write');
    const { id: contactId, taskId } = await params;

    const { data, error } = await ctx.supabase
      .from('contact_commitments')
      .delete()
      .eq('id', taskId)
      .eq('contact_id', contactId)
      .eq('account_id', ctx.accountId)
      .select('id')
      .maybeSingle();
    if (error) {
      console.error('[api/v1/contacts/tasks] delete error:', error);
      return fail('internal', 'Failed to delete task', 500);
    }
    if (!data) return fail('not_found', 'Task not found', 404);

    return ok({ deleted: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
