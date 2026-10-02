// ============================================================
// GET /api/v1/agendapro/available-slots — free hours for a service
// on a given date (scope: agendapro:read). Mirrors the dashboard's
// /api/agendapro/available-slots route; see src/lib/agendapro/server.ts.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { AgendaProApiError, listAvailableHours } from '@/lib/agendapro/server';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'agendapro:read');
    const url = new URL(request.url);
    const serviceId = url.searchParams.get('service_id');
    const date = url.searchParams.get('date');
    if (!serviceId || !date) {
      return fail('bad_request', "'service_id' and 'date' are required", 400);
    }
    const providerId = url.searchParams.get('provider_id');
    const locationId = url.searchParams.get('location_id');
    if (!providerId && !locationId) {
      return fail('bad_request', "Either 'provider_id' or 'location_id' is required", 400);
    }
    const result = await listAvailableHours(ctx.accountId, Number(serviceId), {
      date,
      provider_id: providerId ? Number(providerId) : undefined,
      location_id: locationId ? Number(locationId) : undefined,
    });
    return ok(result);
  } catch (err) {
    if (err instanceof AgendaProApiError) return fail('bad_request', err.message, 400);
    if (err instanceof Error && err.message.includes('AgendaPro no está conectado')) {
      return fail('bad_request', err.message, 400);
    }
    return toApiErrorResponse(err);
  }
}
