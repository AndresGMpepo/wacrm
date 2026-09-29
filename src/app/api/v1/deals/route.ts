// ============================================================
// GET  /api/v1/deals — list deals (scope: deals:read)
// POST /api/v1/deals — create a deal (scope: deals:write)
//
// List is keyset-paginated (see src/lib/api/v1/pagination.ts) and
// supports `?pipeline_id=`, `?stage_id=`, `?contact_id=`, and
// `?status=` (open/won/lost) filters.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { parseListParams, keysetFilter, buildPage } from '@/lib/api/v1/pagination';
import { DEAL_SELECT, serializeDeal, getDealById } from '@/lib/api/v1/deals';
import { resolveAuditUserId, ContactError } from '@/lib/api/v1/contacts';

const STATUSES = ['open', 'won', 'lost'] as const;

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'deals:read');
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);
    const pipelineId = url.searchParams.get('pipeline_id');
    const stageId = url.searchParams.get('stage_id');
    const contactId = url.searchParams.get('contact_id');
    const status = url.searchParams.get('status');

    let query = ctx.supabase
      .from('deals')
      .select(DEAL_SELECT)
      .eq('account_id', ctx.accountId);

    if (pipelineId) query = query.eq('pipeline_id', pipelineId);
    if (stageId) query = query.eq('stage_id', stageId);
    if (contactId) query = query.eq('contact_id', contactId);
    if (status) {
      if (!(STATUSES as readonly string[]).includes(status)) {
        return fail('bad_request', `'status' must be one of ${STATUSES.join(', ')}`, 400);
      }
      query = query.eq('status', status);
    }

    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);

    const { data, error } = await query;
    if (error) {
      console.error('[api/v1/deals] list error:', error);
      return fail('internal', 'Failed to list deals', 500);
    }

    const { items, nextCursor } = buildPage(
      (data ?? []) as unknown as Array<{ created_at: string; id: string }>,
      limit
    );
    return okList(items.map((r) => serializeDeal(r as Record<string, unknown>)), nextCursor);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'deals:write');

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return fail('bad_request', "'title' is required", 400);

    const pipelineId = typeof body.pipeline_id === 'string' ? body.pipeline_id : '';
    if (!pipelineId) return fail('bad_request', "'pipeline_id' is required", 400);

    const stageId = typeof body.stage_id === 'string' ? body.stage_id : '';
    if (!stageId) return fail('bad_request', "'stage_id' is required", 400);

    const { data: stage, error: stageError } = await ctx.supabase
      .from('pipeline_stages')
      .select('id, pipeline_id')
      .eq('id', stageId)
      .eq('pipeline_id', pipelineId)
      .maybeSingle();
    if (stageError) {
      console.error('[api/v1/deals] stage read error:', stageError);
      return fail('internal', 'Failed to validate stage', 500);
    }
    if (!stage) return fail('bad_request', "'stage_id' must belong to 'pipeline_id'", 400);

    const { data: pipeline, error: pipelineError } = await ctx.supabase
      .from('pipelines')
      .select('id')
      .eq('id', pipelineId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (pipelineError) {
      console.error('[api/v1/deals] pipeline read error:', pipelineError);
      return fail('internal', 'Failed to validate pipeline', 500);
    }
    if (!pipeline) return fail('not_found', 'Pipeline not found', 404);

    let contactId: string | null = null;
    if (body.contact_id !== undefined) {
      if (typeof body.contact_id !== 'string') {
        return fail('bad_request', "'contact_id' must be a string", 400);
      }
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
      contactId = contact.id;
    }

    const value = typeof body.value === 'number' && Number.isFinite(body.value) ? body.value : 0;
    const currency = typeof body.currency === 'string' && body.currency.trim() ? body.currency.trim() : 'USD';

    let auditUserId: string;
    try {
      auditUserId = await resolveAuditUserId(ctx.supabase, ctx.accountId);
    } catch (err) {
      if (err instanceof ContactError) return fail('internal', err.message, err.status);
      throw err;
    }

    const { data: created, error: insertError } = await ctx.supabase
      .from('deals')
      .insert({
        account_id: ctx.accountId,
        user_id: auditUserId,
        pipeline_id: pipelineId,
        stage_id: stageId,
        contact_id: contactId,
        title,
        value,
        currency,
        notes: typeof body.notes === 'string' ? body.notes : null,
        expected_close_date: typeof body.expected_close_date === 'string' ? body.expected_close_date : null,
      })
      .select('id')
      .single();
    if (insertError) {
      console.error('[api/v1/deals] insert error:', insertError);
      return fail('internal', 'Failed to create deal', 500);
    }

    const deal = await getDealById(ctx.supabase, ctx.accountId, created.id);
    return ok(deal, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
