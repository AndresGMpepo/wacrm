import type { SupabaseClient } from '@supabase/supabase-js'

import { getGoogleBusy } from './google-calendar'
import { computeSlots, hasOverlap, type Interval, type Slot, type WeeklyWindow } from './slots'

/**
 * Availability for a bookable resource (a specialist or an agent).
 *
 * Resolution order for working hours: the resource's own schedule, and only
 * if it has none, the account-wide default. That way adding hours for one
 * specialist doesn't silently take everyone else off the calendar.
 */

export interface AvailabilityTarget {
  specialistId?: string | null
  agentUserId?: string | null
}

export interface AvailabilityRequest extends AvailabilityTarget {
  accountId: string
  from: Date
  to: Date
  durationMinutes: number
  /** Also subtract what the resource has booked in Google. Default true. */
  includeGoogleBusy?: boolean
}

async function loadWindows(
  db: SupabaseClient,
  accountId: string,
  target: AvailabilityTarget,
): Promise<WeeklyWindow[]> {
  const { data, error } = await db
    .from('appointment_schedules')
    .select('specialist_id, agent_user_id, weekday, start_time, end_time, timezone, slot_minutes, buffer_minutes')
    .eq('account_id', accountId)
    .eq('is_active', true)
  if (error) throw error

  const rows = data ?? []
  const own = rows.filter((row) =>
    target.specialistId
      ? row.specialist_id === target.specialistId
      : target.agentUserId
        ? row.agent_user_id === target.agentUserId
        : false,
  )
  const source = own.length > 0
    ? own
    : rows.filter((row) => !row.specialist_id && !row.agent_user_id)

  return source.map((row) => ({
    weekday: Number(row.weekday),
    start_time: String(row.start_time).slice(0, 5),
    end_time: String(row.end_time).slice(0, 5),
    timezone: (row.timezone as string) || 'UTC',
    slot_minutes: Number(row.slot_minutes) || 30,
    buffer_minutes: Number(row.buffer_minutes) || 0,
  }))
}

/** Appointments and blocks that occupy the resource in the window. */
export async function loadBusyIntervals(
  db: SupabaseClient,
  accountId: string,
  target: AvailabilityTarget,
  from: Date,
  to: Date,
  opts: { ignoreAppointmentId?: string } = {},
): Promise<Interval[]> {
  let appointments = db
    .from('appointments')
    .select('id, starts_at, ends_at')
    .eq('account_id', accountId)
    .neq('status', 'cancelled')
    .lt('starts_at', to.toISOString())
    .gt('ends_at', from.toISOString())
  appointments = target.specialistId
    ? appointments.eq('specialist_id', target.specialistId)
    : target.agentUserId
      ? appointments.eq('assigned_agent_id', target.agentUserId)
      : appointments

  const exceptions = db
    .from('appointment_schedule_exceptions')
    .select('specialist_id, agent_user_id, starts_at, ends_at')
    .eq('account_id', accountId)
    .lt('starts_at', to.toISOString())
    .gt('ends_at', from.toISOString())

  const [appointmentResult, exceptionResult] = await Promise.all([appointments, exceptions])
  if (appointmentResult.error) throw appointmentResult.error
  if (exceptionResult.error) throw exceptionResult.error

  const busy: Interval[] = []
  for (const row of appointmentResult.data ?? []) {
    if (opts.ignoreAppointmentId && row.id === opts.ignoreAppointmentId) continue
    busy.push({ start: new Date(row.starts_at as string), end: new Date(row.ends_at as string) })
  }
  for (const row of exceptionResult.data ?? []) {
    // An account-wide exception (a holiday) blocks everyone.
    const appliesToResource =
      (!row.specialist_id && !row.agent_user_id) ||
      (target.specialistId && row.specialist_id === target.specialistId) ||
      (target.agentUserId && row.agent_user_id === target.agentUserId)
    if (!appliesToResource) continue
    busy.push({ start: new Date(row.starts_at as string), end: new Date(row.ends_at as string) })
  }
  return busy
}

export async function getAvailableSlots(
  db: SupabaseClient,
  request: AvailabilityRequest,
): Promise<{ slots: Slot[]; hasSchedule: boolean }> {
  const windows = await loadWindows(db, request.accountId, request)
  if (windows.length === 0) return { slots: [], hasSchedule: false }

  const busy = await loadBusyIntervals(db, request.accountId, request, request.from, request.to)
  if (request.includeGoogleBusy !== false) {
    const googleBusy = await getGoogleBusy(
      request.accountId,
      { specialistId: request.specialistId ?? null, assignedAgentId: request.agentUserId ?? null },
      request.from,
      request.to,
    )
    busy.push(...googleBusy)
  }

  return {
    slots: computeSlots({
      windows,
      busy,
      from: request.from,
      to: request.to,
      durationMinutes: request.durationMinutes,
    }),
    hasSchedule: true,
  }
}

/**
 * Guard for the booking routes. The database also refuses overlapping
 * bookings for a specialist (migration 116), but agents have no such
 * constraint and a readable error beats a raw 23P01.
 */
export async function findConflict(
  db: SupabaseClient,
  accountId: string,
  target: AvailabilityTarget,
  startsAt: Date,
  endsAt: Date,
  opts: { ignoreAppointmentId?: string } = {},
): Promise<boolean> {
  if (!target.specialistId && !target.agentUserId) return false
  const busy = await loadBusyIntervals(db, accountId, target, startsAt, endsAt, opts)
  return hasOverlap({ start: startsAt, end: endsAt }, busy)
}
