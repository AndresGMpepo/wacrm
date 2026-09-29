// ============================================================
// GET /api/v1/pipelines — list pipelines with their stages
// (scope: deals:read)
//
// A pipeline is just deal-organizing metadata (name + ordered
// stages) — small enough per account that this returns everything in
// one call, no pagination. Use a stage's `id` as `stage_id` when
// creating/moving a deal.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'deals:read');

    const { data: pipelines, error: pipelinesError } = await ctx.supabase
      .from('pipelines')
      .select('id, name, created_at')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: true });
    if (pipelinesError) {
      console.error('[api/v1/pipelines] list error:', pipelinesError);
      return fail('internal', 'Failed to list pipelines', 500);
    }

    const pipelineIds = (pipelines ?? []).map((p) => p.id);
    const { data: stages, error: stagesError } = pipelineIds.length
      ? await ctx.supabase
          .from('pipeline_stages')
          .select('id, pipeline_id, name, color, position')
          .in('pipeline_id', pipelineIds)
          .order('position', { ascending: true })
      : { data: [], error: null };
    if (stagesError) {
      console.error('[api/v1/pipelines] stages error:', stagesError);
      return fail('internal', 'Failed to list pipeline stages', 500);
    }

    const stagesByPipeline = new Map<string, typeof stages>();
    for (const stage of stages ?? []) {
      const bucket = stagesByPipeline.get(stage.pipeline_id) ?? [];
      bucket.push(stage);
      stagesByPipeline.set(stage.pipeline_id, bucket);
    }

    return ok(
      (pipelines ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        created_at: p.created_at,
        stages: (stagesByPipeline.get(p.id) ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          color: s.color,
          position: s.position,
        })),
      })),
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
