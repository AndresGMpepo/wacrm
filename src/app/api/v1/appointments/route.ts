// ============================================================
// GET  /api/v1/appointments — list appointments (scope: appointments:read)
// POST /api/v1/appointments — create an appointment (scope: appointments:write)
//
// Filters: `?from=`/`?to=` (ISO, default: 7 days ago .. 30 days
// ahead — same window the dashboard uses), `?status=`, `?contact_id=`,
// `?specialist_id=`. Not keyset-paginated (bounded by the date
// window like the dashboard's own calendar view).
//
// Create reuses the EXACT SAME shared libs the dashboard route uses
// for conflict detection and Google Calendar sync
// (src/lib/appointments/{availability,google-calendar,memory}.ts) —
// see src/lib/api/v1/appointments.ts for why.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { resolveAuditUserId, ContactError } from '@/lib/api/v1/contacts';
import {
  APPOINTMENT_SELECT,
  getAppointmentById,
  validGoogleConnectionId,
  validSpecialistId,
  type ApiAppointment,
} from '@/lib/api/v1/appointments';
import { findConflict } from '@/lib/appointments/availability';
import { syncGoogleAppointment } from '@/lib/appointments/google-calendar';
import { recordAppointmentMemoryEvent } from '@/lib/appointments/memory';

const STATUSES = ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'] as const;

function parseDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function formatEventDate(iso: string) {
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'appointments:read');
    const url = new URL(request.url);
    const from = parseDate(url.searchParams.get('from')) ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
    const to = parseDate(url.searchParams.get('to')) ?? new Date(Date.now() + 30 * 86_400_000).toISOString();
    const status = url.searchParams.get('status');
    const contactId = url.searchParams.get('contact_id');
    const specialistId = url.searchParams.get('specialist_id');

    if (status && !(STATUSES as readonly string[]).includes(status)) {
      return fail('bad_request', `'status' must be one of ${STATUSES.join(', ')}`, 400);
    }

    let query = ctx.supabase
      .from('appointments')
      .select(APPOINTMENT_SELECT)
      .eq('account_id', ctx.accountId)
      .gte('starts_at', from)
      .lt('starts_at', to)
      .order('starts_at', { ascending: true });

    if (status) query = query.eq('status', status);
    if (contactId) query = query.eq('contact_id', contactId);
    if (specialistId) query = query.eq('specialist_id', specialistId);

    const { data, error } = await query;
    if (error) {
      console.error('[api/v1/appointments] list error:', error);
      return fail('internal', 'Failed to list appointments', 500);
    }

    return okList(data ?? [], null);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'appointments:write');

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 160) : '';
    const startsAt = parseDate(body.starts_at);
    const endsAt = parseDate(body.ends_at);
    if (!title || !startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt)) {
      return fail('bad_request', "'title', 'starts_at', and 'ends_at' are required, and 'ends_at' must be after 'starts_at'", 400);
    }

    let auditUserId: string;
    try {
      auditUserId = await resolveAuditUserId(ctx.supabase, ctx.accountId);
    } catch (err) {
      if (err instanceof ContactError) return fail('internal', err.message, err.status);
      throw err;
    }

    const contactId = typeof body.contact_id === 'string' ? body.contact_id : null;
    const assignedAgentId = typeof body.assigned_agent_id === 'string' ? body.assigned_agent_id : auditUserId;
    const specialistId = typeof body.specialist_id === 'string' && body.specialist_id.trim() ? body.specialist_id : null;

    const [contactResult, agentResult, specialistValid] = await Promise.all([
      contactId
        ? ctx.supabase.from('contacts').select('id').eq('id', contactId).eq('account_id', ctx.accountId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      ctx.supabase.from('profiles').select('user_id').eq('user_id', assignedAgentId).eq('account_id', ctx.accountId).eq('is_active', true).maybeSingle(),
      specialistId ? validSpecialistId(ctx.supabase, ctx.accountId, specialistId) : Promise.resolve(true),
    ]);
    if (contactResult.error) {
      console.error('[api/v1/appointments] contact read error:', contactResult.error);
      return fail('internal', 'Failed to validate contact', 500);
    }
    if (agentResult.error) {
      console.error('[api/v1/appointments] agent read error:', agentResult.error);
      return fail('internal', 'Failed to validate agent', 500);
    }
    if (contactId && !contactResult.data) return fail('bad_request', "'contact_id' does not belong to this account", 400);
    if (!agentResult.data) return fail('bad_request', "'assigned_agent_id' must belong to an active member of this account", 400);
    if (specialistId && !specialistValid) return fail('bad_request', "'specialist_id' does not exist in this account", 400);

    const googleCalendarConnectionId = typeof body.google_calendar_connection_id === 'string' ? body.google_calendar_connection_id : null;
    if (googleCalendarConnectionId && !(await validGoogleConnectionId(ctx.supabase, ctx.accountId, googleCalendarConnectionId, specialistId))) {
      return fail('bad_request', "'google_calendar_connection_id' is not available for this specialist", 400);
    }

    // The database also refuses overlapping specialist bookings
    // (migration 116); this catches the agent case too with a readable error.
    if (await findConflict(ctx.supabase, ctx.accountId, { specialistId, agentUserId: specialistId ? null : assignedAgentId }, new Date(startsAt), new Date(endsAt))) {
      return fail('bad_request', 'That time slot is already booked. Choose a different time.', 409);
    }

    const { data: createdRow, error: insertError } = await ctx.supabase
      .from('appointments')
      .insert({
        account_id: ctx.accountId,
        created_by: auditUserId,
        title,
        starts_at: startsAt,
        ends_at: endsAt,
        contact_id: contactId,
        assigned_agent_id: assignedAgentId,
        specialist_id: specialistId,
        google_calendar_connection_id: googleCalendarConnectionId,
        notes: typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) || null : null,
        timezone: typeof body.timezone === 'string' ? body.timezone.slice(0, 80) : 'UTC',
      })
      .select(APPOINTMENT_SELECT)
      .single();
    if (insertError) {
      console.error('[api/v1/appointments] insert error:', insertError);
      return fail('internal', 'Failed to create appointment', 500);
    }
    const created = createdRow as unknown as ApiAppointment;

    await ctx.supabase.from('appointment_audit_log').insert({
      account_id: ctx.accountId,
      appointment_id: created.id,
      actor_user_id: auditUserId,
      source: 'nexoomni',
      action: 'created',
      after_data: { title, starts_at: startsAt, ends_at: endsAt, status: created.status },
    });

    await syncGoogleAppointment(ctx.accountId, created).catch(async (syncError) => {
      console.error('[api/v1/appointments] Google Calendar sync failed:', syncError);
      await ctx.supabase
        .from('appointments')
        .update({
          google_sync_status: 'failed',
          google_sync_error: syncError instanceof Error ? syncError.message.slice(0, 500) : 'Unknown Google Calendar error.',
        })
        .eq('id', created.id)
        .eq('account_id', ctx.accountId);
    });

    if (contactId) {
      await recordAppointmentMemoryEvent({
        accountId: ctx.accountId,
        contactId,
        appointmentId: created.id,
        summary: `Cita agendada: ${title} para el ${formatEventDate(startsAt)}.`,
      }).catch((memoryError) => {
        console.error('[nexo-memory] Failed to record appointment scheduled event:', memoryError);
      });
    }

    const appointment = await getAppointmentById(ctx.supabase, ctx.accountId, created.id);
    return ok(appointment, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
