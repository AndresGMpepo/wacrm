import { zonedWallClockToUtc } from '@/lib/appointments/slots'

/**
 * AgendaPro's `start`/`end` timestamps carry a trailing "Z" (as if UTC),
 * but are actually the clinic's own local wall-clock time with that
 * suffix tacked on — not a real UTC conversion. Confirmed empirically:
 * a booking AgendaPro's own calendar shows at 10:00 (Mexico City, UTC-6)
 * comes back from `GET /bookings` as "...T10:00:00.000Z". Parsed as real
 * UTC (`new Date(iso)`) and then displayed in the browser's local time,
 * every booking silently shifts by the account's UTC offset — exactly
 * the 6-hour-early bug a side-by-side comparison with AgendaPro's own
 * calendar surfaced.
 *
 * This parses the digits literally as a local `Date` instead of letting
 * the "Z" trigger a UTC→local conversion, so whatever wall-clock time
 * AgendaPro printed is exactly what renders — regardless of the
 * browser's own timezone.
 */
export function parseAgendaProTime(iso: string): Date {
  const [, year, month, day, hour, minute, second] = matchWallClock(iso) ?? []
  if (!year) return new Date(iso)
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
}

function matchWallClock(iso: string) {
  return /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(iso) ?? undefined
}

/**
 * Server-side counterpart of parseAgendaProTime, for data that's about
 * to be stored in a real `timestamptz` column (agendapro_bookings —
 * see migration 134/136) rather than just displayed. Reuses the exact
 * zone-aware wall-clock→UTC math the internal Appointments module
 * already relies on for working-hours scheduling (src/lib/appointments/
 * slots.ts) — this is generic date arithmetic, not a coupling between
 * the two (intentionally independent) modules.
 *
 * Returns the *correct* absolute instant (ISO, real UTC) for the given
 * account timezone. Falls back to the original string unmodified if it
 * isn't in AgendaPro's expected shape.
 */
export function correctAgendaProInstant(iso: string, timeZone: string): string {
  const match = matchWallClock(iso)
  if (!match) return iso
  const [, year, month, day, hour, minute, second] = match
  const dateKey = `${year}-${month}-${day}`
  const time = `${hour}:${minute}:${second}`
  return zonedWallClockToUtc(dateKey, time, timeZone).toISOString()
}
