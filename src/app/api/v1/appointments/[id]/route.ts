// ============================================================
// GET   /api/v1/appointments/{id} — read an appointment
// PATCH /api/v1/appointments/{id} — update an appointment
// (scope: appointments:read / appointments:write)
//
// PATCH mirrors the dashboard's own PATCH — same conflict re-check on
// reschedule, same Google Calendar sync trigger, same Nexo Memory
// lifecycle events for completed/no_show/cancelled/rescheduled — by
// calling the identical shared libs, not a re-implementation.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  APPOINTMENT_SELECT,
  getAppointmentById,
  validGoogleConnectionId,
  validSpecialistId,
  type ApiAppointment,
} from '@/lib/api/v1/appointments';
import { findConflict } from '@/lib/appointments/availability';
import { syncGoogleAppointment } from '@/lib/appointments/google-calendar';
import { recordAppointmentMemoryEvent, upsertAppointmentFollowUp } from '@/lib/appointments/memory';

const STATUSES = ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'] as const;

function parseDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function formatEventDate(iso: string) {
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'appointments:read');
    const { id } = await params;
    const appointment = await getAppointmentById(ctx.supabase, ctx.accountId, id);
    if (!appointment) return fail('not_found', 'Appointment not found', 404);
    return ok(appointment);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'appointments:write');
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const { data: before, error: beforeError } = await ctx.supabase
      .from('appointments')
      .select('contact_id, title, starts_at, status, specialist_id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (beforeError) {
      console.error('[api/v1/appointments] read error:', beforeError);
      return fail('internal', 'Failed to read appointment', 500);
    }
    if (!before) return fail('not_found', 'Appointment not found', 404);

    const status = typeof body.status === 'string' && (STATUSES as readonly string[]).includes(body.status) ? body.status : null;
    if ('status' in body && !status) {
      return fail('bad_request', `'status' must be one of ${STATUSES.join(', ')}`, 400);
    }

    const startsAt = body.starts_at === undefined ? undefined : parseDate(body.starts_at);
    const endsAt = body.ends_at === undefined ? undefined : parseDate(body.ends_at);
    if ((body.starts_at !== undefined && !startsAt) || (body.ends_at !== undefined && !endsAt)) {
      return fail('bad_request', "'starts_at'/'ends_at' must be valid ISO 8601 date-times", 400);
    }
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      return fail('bad_request', "'ends_at' must be after 'starts_at'", 400);
    }

    const update: Record<string, unknown> = {};
    if (status) update.status = status;
    if (typeof body.title === 'string' && body.title.trim()) update.title = body.title.trim().slice(0, 160);
    if (typeof body.notes === 'string') update.notes = body.notes.trim().slice(0, 2000) || null;
    if (startsAt) update.starts_at = startsAt;
    if (endsAt) update.ends_at = endsAt;
    if (typeof body.timezone === 'string') update.timezone = body.timezone.slice(0, 80);

    if (typeof body.contact_id === 'string' || body.contact_id === null) {
      if (typeof body.contact_id === 'string') {
        const { data: contact, error } = await ctx.supabase.from('contacts').select('id').eq('id', body.contact_id).eq('account_id', ctx.accountId).maybeSingle();
        if (error) {
          console.error('[api/v1/appointments] contact read error:', error);
          return fail('internal', 'Failed to validate contact', 500);
        }
        if (!contact) return fail('bad_request', "'contact_id' does not belong to this account", 400);
      }
      update.contact_id = body.contact_id;
    }

    if (typeof body.assigned_agent_id === 'string') {
      const { data: member, error } = await ctx.supabase.from('profiles').select('user_id').eq('user_id', body.assigned_agent_id).eq('account_id', ctx.accountId).eq('is_active', true).maybeSingle();
      if (error) {
        console.error('[api/v1/appointments] agent read error:', error);
        return fail('internal', 'Failed to validate agent', 500);
      }
      if (!member) return fail('bad_request', "'assigned_agent_id' must belong to an active member of this account", 400);
      update.assigned_agent_id = body.assigned_agent_id;
    }

    if (typeof body.specialist_id === 'string' || body.specialist_id === null) {
      if (typeof body.specialist_id === 'string' && !(await validSpecialistId(ctx.supabase, ctx.accountId, body.specialist_id))) {
        return fail('bad_request', "'specialist_id' does not exist in this account", 400);
      }
      update.specialist_id = body.specialist_id;
    }

    if (typeof body.google_calendar_connection_id === 'string' || body.google_calendar_connection_id === null) {
      if (typeof body.google_calendar_connection_id === 'string') {
        const scopeSpecialistId = 'specialist_id' in update ? (update.specialist_id as string | null) : (before.specialist_id ?? null);
        if (!(await validGoogleConnectionId(ctx.supabase, ctx.accountId, body.google_calendar_connection_id, scopeSpecialistId))) {
          return fail('bad_request', "'google_calendar_connection_id' is not available for this specialist", 400);
        }
      }
      update.google_calendar_connection_id = body.google_calendar_connection_id;
    }

    if (Object.keys(update).length === 0) {
      return fail('bad_request', 'Provide at least one field to update', 400);
    }

    // Rescheduling has to clear the new slot too — but never against itself.
    if ((startsAt || endsAt) && update.status !== 'cancelled') {
      const { data: current } = await ctx.supabase
        .from('appointments')
        .select('starts_at, ends_at, assigned_agent_id, specialist_id')
        .eq('id', id)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      const nextStart = new Date((startsAt ?? current?.starts_at) as string);
      const nextEnd = new Date((endsAt ?? current?.ends_at) as string);
      const specialist = 'specialist_id' in update ? (update.specialist_id as string | null) : (current?.specialist_id ?? null);
      const agent = 'assigned_agent_id' in update ? (update.assigned_agent_id as string) : (current?.assigned_agent_id ?? null);
      if (
        await findConflict(
          ctx.supabase,
          ctx.accountId,
          { specialistId: specialist, agentUserId: specialist ? null : agent },
          nextStart,
          nextEnd,
          { ignoreAppointmentId: id },
        )
      ) {
        return fail('bad_request', 'That time slot is already booked. Choose a different time.', 409);
      }
    }

    const { data: updatedRow, error } = await ctx.supabase
      .from('appointments')
      .update(update)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(APPOINTMENT_SELECT)
      .maybeSingle();
    if (error) {
      console.error('[api/v1/appointments] update error:', error);
      return fail('internal', 'Failed to update appointment', 500);
    }
    if (!updatedRow) return fail('not_found', 'Appointment not found', 404);
    const data = updatedRow as unknown as ApiAppointment;

    await ctx.supabase.from('appointment_audit_log').insert({
      account_id: ctx.accountId,
      appointment_id: id,
      actor_user_id: null,
      source: 'nexoomni',
      action: status ? `status_${status}` : 'updated',
      after_data: update,
    });

    await syncGoogleAppointment(ctx.accountId, data).catch(async (syncError) => {
      console.error('[api/v1/appointments] Google Calendar sync failed:', syncError);
      await ctx.supabase
        .from('appointments')
        .update({
          google_sync_status: 'failed',
          google_sync_error: syncError instanceof Error ? syncError.message.slice(0, 500) : 'Unknown Google Calendar error.',
        })
        .eq('id', data.id)
        .eq('account_id', ctx.accountId);
    });

    const contactId = 'contact_id' in update ? (update.contact_id as string | null) : before.contact_id;
    if (contactId) {
      const when = formatEventDate(data.starts_at);
      const logMemoryError = (memoryError: unknown) => console.error('[nexo-memory] Failed to record appointment event:', memoryError);
      if (status === 'completed' && before.status !== 'completed') {
        await recordAppointmentMemoryEvent({ accountId: ctx.accountId, contactId, appointmentId: id, summary: `Asistió a su cita: ${data.title} (${when}).` }).catch(logMemoryError);
      } else if (status === 'no_show' && before.status !== 'no_show') {
        await recordAppointmentMemoryEvent({ accountId: ctx.accountId, contactId, appointmentId: id, summary: `No asistió a su cita programada: ${data.title} (${when}).`, importance: 'high' }).catch(logMemoryError);
        await upsertAppointmentFollowUp({ accountId: ctx.accountId, contactId, appointmentId: id, description: `Contactar para reagendar la cita perdida: ${data.title}` }).catch(logMemoryError);
      } else if (status === 'cancelled' && before.status !== 'cancelled') {
        await recordAppointmentMemoryEvent({ accountId: ctx.accountId, contactId, appointmentId: id, summary: `Canceló su cita: ${data.title} (${when}).` }).catch(logMemoryError);
        await upsertAppointmentFollowUp({ accountId: ctx.accountId, contactId, appointmentId: id, description: `Confirmar si desea reagendar tras cancelar: ${data.title}` }).catch(logMemoryError);
      } else if (!status && startsAt && startsAt !== before.starts_at) {
        await recordAppointmentMemoryEvent({ accountId: ctx.accountId, contactId, appointmentId: id, summary: `Reagendó su cita del ${formatEventDate(before.starts_at)} al ${when}: ${data.title}.` }).catch(logMemoryError);
      }
    }

    return ok(data);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
