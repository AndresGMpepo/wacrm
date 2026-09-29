// ============================================================
// GET   /api/v1/deals/{id} — read a deal (scope: deals:read)
// PATCH /api/v1/deals/{id} — update a deal (scope: deals:write)
//
// Both are account-scoped: a deal belonging to another account
// returns 404. PATCH updates only the fields present in the body —
// moving `stage_id` (e.g. across the pipeline board) is just another
// field update, validated to belong to the deal's own pipeline.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { getDealById } from '@/lib/api/v1/deals';

const STATUSES = ['open', 'won', 'lost'] as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'deals:read');
    const { id } = await params;
    const deal = await getDealById(ctx.supabase, ctx.accountId, id);
    if (!deal) return fail('not_found', 'Deal not found', 404);
    return ok(deal);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'deals:write');
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const existing = await getDealById(ctx.supabase, ctx.accountId, id);
    if (!existing) return fail('not_found', 'Deal not found', 404);

    const updates: Record<string, unknown> = {};

    if ('title' in body) {
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title) return fail('bad_request', "'title' cannot be empty", 400);
      updates.title = title;
    }

    if ('value' in body) {
      if (typeof body.value !== 'number' || !Number.isFinite(body.value)) {
        return fail('bad_request', "'value' must be a number", 400);
      }
      updates.value = body.value;
    }

    if ('currency' in body) {
      if (typeof body.currency !== 'string' || !body.currency.trim()) {
        return fail('bad_request', "'currency' must be a non-empty string", 400);
      }
      updates.currency = body.currency.trim();
    }

    if ('status' in body) {
      const status = typeof body.status === 'string' && (STATUSES as readonly string[]).includes(body.status)
        ? body.status
        : null;
      if (!status) return fail('bad_request', `'status' must be one of ${STATUSES.join(', ')}`, 400);
      updates.status = status;
    }

    if ('stage_id' in body) {
      if (typeof body.stage_id !== 'string') {
        return fail('bad_request', "'stage_id' must be a string", 400);
      }
      const { data: stage, error: stageError } = await ctx.supabase
        .from('pipeline_stages')
        .select('id')
        .eq('id', body.stage_id)
        .eq('pipeline_id', existing.pipeline_id)
        .maybeSingle();
      if (stageError) {
        console.error('[api/v1/deals] stage read error:', stageError);
        return fail('internal', 'Failed to validate stage', 500);
      }
      if (!stage) return fail('bad_request', "'stage_id' must belong to this deal's pipeline", 400);
      updates.stage_id = body.stage_id;
    }

    if ('notes' in body) {
      if (body.notes !== null && typeof body.notes !== 'string') {
        return fail('bad_request', "'notes' must be a string or null", 400);
      }
      updates.notes = body.notes;
    }

    if ('expected_close_date' in body) {
      if (body.expected_close_date !== null && typeof body.expected_close_date !== 'string') {
        return fail('bad_request', "'expected_close_date' must be a date string or null", 400);
      }
      updates.expected_close_date = body.expected_close_date;
    }

    if ('contact_id' in body) {
      if (body.contact_id !== null && typeof body.contact_id !== 'string') {
        return fail('bad_request', "'contact_id' must be a string or null", 400);
      }
      if (body.contact_id) {
        const { data: contact, error: contactError } = await ctx.supabase
          .from('contacts')
          .select('id')
          .eq('id', body.contact_id)
          .eq('account_id', ctx.accountId)
          .maybeSingle();
        if (contactError) {
          console.error('[api/v1/deals] contact read error:', contactError);
          return fail('internal', 'Failed to validate contact', 500);
        }
        if (!contact) return fail('bad_request', "'contact_id' does not belong to this account", 400);
      }
      updates.contact_id = body.contact_id;
    }

    if (Object.keys(updates).length === 0) {
      return fail('bad_request', 'Provide at least one field to update', 400);
    }

    updates.updated_at = new Date().toISOString();
    const { error } = await ctx.supabase
      .from('deals')
      .update(updates)
      .eq('id', id)
      .eq('account_id', ctx.accountId);
    if (error) {
      console.error('[api/v1/deals] update error:', error);
      return fail('internal', 'Failed to update deal', 500);
    }

    const deal = await getDealById(ctx.supabase, ctx.accountId, id);
    return ok(deal);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
