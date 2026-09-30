// ============================================================
// GET /api/v1/appointments/availability — free time slots
// (scope: appointments:read)
//
// Reuses the exact same shared lib the dashboard's own availability
// picker uses (src/lib/appointments/availability.ts) — same working
// hours, holidays, buffer time, existing bookings, and Google Calendar
// busy time — so the public API can never suggest a slot the
// dashboard itself wouldn't offer.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { getAvailableSlots } from '@/lib/appointments/availability';

const MAX_RANGE_DAYS = 60;

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'appointments:read');
    const url = new URL(request.url);

    const specialistId = url.searchParams.get('specialist_id');
    const agentUserId = url.searchParams.get('agent_id');
    const duration = Math.min(480, Math.max(5, Number(url.searchParams.get('duration')) || 30));

    const from = url.searchParams.get('from') ? new Date(url.searchParams.get('from') as string) : new Date();
    const to = url.searchParams.get('to')
      ? new Date(url.searchParams.get('to') as string)
      : new Date(from.getTime() + 7 * 86_400_000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      return fail('bad_request', "'from'/'to' must be valid ISO 8601 date-times, with 'to' after 'from'", 400);
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) {
      return fail('bad_request', `Query at most ${MAX_RANGE_DAYS} days per request`, 400);
    }

    if (specialistId) {
      const { data: specialist, error } = await ctx.supabase
        .from('specialists')
        .select('id')
        .eq('id', specialistId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (error) {
        console.error('[api/v1/appointments/availability] specialist read error:', error);
        return fail('internal', 'Failed to validate specialist', 500);
      }
      if (!specialist) return fail('bad_request', "'specialist_id' does not exist in this account", 400);
    }

    const { slots, hasSchedule } = await getAvailableSlots(ctx.supabase, {
      accountId: ctx.accountId,
      specialistId,
      agentUserId,
      from,
      to,
      durationMinutes: duration,
    });

    return ok({ slots, duration_minutes: duration, has_schedule: hasSchedule });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
