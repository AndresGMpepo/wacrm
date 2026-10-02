// ============================================================
// GET /api/v1/agendapro/catalog?resource=locations|services|providers
// (scope: agendapro:read). Mirrors the dashboard's
// /api/agendapro/catalog route; see src/lib/agendapro/server.ts.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { AgendaProApiError, listAgendaProLocations, listAgendaProProviders, listAgendaProServices } from '@/lib/agendapro/server';

const RESOURCES = ['locations', 'services', 'providers'] as const;

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'agendapro:read');
    const url = new URL(request.url);
    const resource = url.searchParams.get('resource');
    if (!resource || !(RESOURCES as readonly string[]).includes(resource)) {
      return fail('bad_request', `'resource' must be one of ${RESOURCES.join(', ')}`, 400);
    }
    const result = await (
      resource === 'locations' ? listAgendaProLocations(ctx.accountId) :
      resource === 'services' ? listAgendaProServices(ctx.accountId) :
      listAgendaProProviders(ctx.accountId)
    );
    return ok(result);
  } catch (err) {
    if (err instanceof AgendaProApiError) return fail('bad_request', err.message, 400);
    if (err instanceof Error && err.message.includes('AgendaPro no está conectado')) {
      return fail('bad_request', err.message, 400);
    }
    return toApiErrorResponse(err);
  }
}
