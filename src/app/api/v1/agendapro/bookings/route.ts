// ============================================================
// GET  /api/v1/agendapro/bookings — list AgendaPro bookings (scope: agendapro:read)
// POST /api/v1/agendapro/bookings — create a booking (scope: agendapro:write)
//
// Fetch-through to AgendaPro's own API (no local cache — see
// src/lib/agendapro/server.ts), same as the dashboard's
// /api/agendapro/bookings route. AgendaProApiError and the "not
// connected" error both map to a 400 instead of a generic 500 so an
// integrator can tell "you haven't connected AgendaPro yet" apart
// from a real server failure.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { AgendaProApiError, createAgendaProBooking, listAgendaProBookings } from '@/lib/agendapro/server';

function parseNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function toSingleArray(value: number | undefined): number[] | undefined {
  return value === undefined ? undefined : [value];
}

async function handleAgendaProError(err: unknown) {
  if (err instanceof AgendaProApiError) {
    return fail('bad_request', err.message, 400);
  }
  if (err instanceof Error && err.message.includes('AgendaPro no está conectado')) {
    return fail('bad_request', err.message, 400);
  }
  return toApiErrorResponse(err);
}

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'agendapro:read');
    const url = new URL(request.url);

    let clients: number[] | undefined;
    const contactId = url.searchParams.get('contact_id');
    if (contactId) {
      const { data: mapped } = await ctx.supabase
        .from('agendapro_clients')
        .select('agendapro_client_id')
        .eq('account_id', ctx.accountId)
        .eq('contact_id', contactId)
        .maybeSingle();
      if (mapped?.agendapro_client_id) clients = [Number(mapped.agendapro_client_id)];
    }

    const result = await listAgendaProBookings(ctx.accountId, {
      clients,
      locations: toSingleArray(parseNumber(url.searchParams.get('location_id'))),
      services: toSingleArray(parseNumber(url.searchParams.get('service_id'))),
      providers: toSingleArray(parseNumber(url.searchParams.get('provider_id'))),
      range_from: url.searchParams.get('range_from') || undefined,
      range_to: url.searchParams.get('range_to') || undefined,
      page: parseNumber(url.searchParams.get('page')),
    });
    return okList(Array.isArray(result) ? result : [], null);
  } catch (err) {
    return handleAgendaProError(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'agendapro:write');
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const contactId = typeof body.contact_id === 'string' ? body.contact_id : '';
    const serviceId = Number(body.service_id);
    const providerId = Number(body.provider_id);
    const start = typeof body.start === 'string' ? body.start : '';
    const end = typeof body.end === 'string' ? body.end : '';
    if (!contactId || !serviceId || !providerId || !start || !end) {
      return fail('bad_request', "'contact_id', 'service_id', 'provider_id', 'start', and 'end' are required", 400);
    }

    const { data: contact, error: contactError } = await ctx.supabase
      .from('contacts')
      .select('name, phone, email')
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (contactError) {
      console.error('[api/v1/agendapro/bookings] contact read error:', contactError);
      return fail('internal', 'Failed to validate contact', 500);
    }
    if (!contact) return fail('bad_request', "'contact_id' does not belong to this account", 400);
    const [firstName, ...rest] = (contact.name || 'Cliente').trim().split(/\s+/);

    const created = (await createAgendaProBooking(ctx.accountId, {
      start,
      end,
      service_id: serviceId,
      provider_id: providerId,
      price: typeof body.price === 'number' ? body.price : undefined,
      first_name: firstName || 'Cliente',
      last_name: rest.join(' ') || undefined,
      email: contact.email || undefined,
      phone: contact.phone || undefined,
    })) as { id: number; client?: { id?: number } };

    if (created.client?.id) {
      await ctx.supabase.from('agendapro_clients').upsert({
        account_id: ctx.accountId,
        contact_id: contactId,
        agendapro_client_id: String(created.client.id),
        synced_at: new Date().toISOString(),
      }, { onConflict: 'account_id,agendapro_client_id' });
    }
    return ok(created, 201);
  } catch (err) {
    return handleAgendaProError(err);
  }
}
