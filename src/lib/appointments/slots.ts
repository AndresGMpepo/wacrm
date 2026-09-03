/**
 * Working-hours arithmetic for appointment availability.
 *
 * Kept free of I/O so the slot maths can be tested directly: schedules are
 * stored as local wall-clock times ("Tuesdays 09:00–14:00, America/Mexico_City")
 * and every consumer needs absolute instants. Doing that with plain Date
 * arithmetic silently breaks twice a year, so the conversion goes through
 * the zone's real offset at that instant.
 */

export interface WeeklyWindow {
  /** 0 = Sunday … 6 = Saturday (JavaScript's getDay). */
  weekday: number
  /** "HH:MM" local to `timezone`. */
  start_time: string
  end_time: string
  timezone: string
  slot_minutes: number
  buffer_minutes: number
}

export interface Interval {
  start: Date
  end: Date
}

export interface Slot {
  start: string
  end: string
}

function offsetMs(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(date)) parts[part.type] = part.value
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  )
  return asUtc - date.getTime()
}

/** Absolute instant for a wall-clock time in a zone, DST included. */
export function zonedWallClockToUtc(dateKey: string, time: string, timeZone: string): Date {
  const naive = new Date(`${dateKey}T${time.length === 5 ? `${time}:00` : time}Z`)
  const firstGuess = new Date(naive.getTime() - offsetMs(naive, timeZone))
  // A second pass settles the hour when the offset itself changed that day.
  const corrected = new Date(naive.getTime() - offsetMs(firstGuess, timeZone))
  return corrected
}

/** Calendar day (YYYY-MM-DD) and weekday of an instant, in a zone. */
export function zonedDayInfo(date: Date, timeZone: string): { key: string; weekday: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  })
  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(date)) parts[part.type] = part.value
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return {
    key: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: Math.max(0, weekdays.indexOf(parts.weekday)),
  }
}

function subtract(intervals: Interval[], busy: Interval[]): Interval[] {
  let result = intervals
  for (const block of busy) {
    const next: Interval[] = []
    for (const free of result) {
      if (block.end <= free.start || block.start >= free.end) {
        next.push(free)
        continue
      }
      if (block.start > free.start) next.push({ start: free.start, end: block.start })
      if (block.end < free.end) next.push({ start: block.end, end: free.end })
    }
    result = next
  }
  return result
}

/**
 * Free slots between `from` and `to`.
 *
 * `busy` holds everything that blocks the calendar: existing appointments,
 * schedule exceptions and (when connected) Google's busy ranges. Each busy
 * range is padded by the window's buffer so back-to-back bookings keep the
 * configured gap.
 */
export function computeSlots(args: {
  windows: WeeklyWindow[]
  busy: Interval[]
  from: Date
  to: Date
  durationMinutes: number
  /** Slots starting before this instant are dropped (default: now). */
  notBefore?: Date
}): Slot[] {
  const { windows, busy, from, to, durationMinutes } = args
  if (windows.length === 0 || durationMinutes <= 0) return []
  const notBefore = args.notBefore ?? new Date()
  const durationMs = durationMinutes * 60_000

  // Walk day by day in each window's own zone: an account can have one
  // specialist in Mexico City and another in Madrid.
  const free: { interval: Interval; window: WeeklyWindow }[] = []
  for (const window of windows) {
    const seen = new Set<string>()
    for (
      let cursor = new Date(from.getTime() - 86_400_000);
      cursor.getTime() <= to.getTime() + 86_400_000;
      cursor = new Date(cursor.getTime() + 86_400_000)
    ) {
      const { key, weekday } = zonedDayInfo(cursor, window.timezone)
      if (seen.has(key) || weekday !== window.weekday) continue
      seen.add(key)
      const start = zonedWallClockToUtc(key, window.start_time, window.timezone)
      const end = zonedWallClockToUtc(key, window.end_time, window.timezone)
      if (end <= from || start >= to) continue
      free.push({
        interval: { start: start < from ? from : start, end: end > to ? to : end },
        window,
      })
    }
  }

  const slots: Slot[] = []
  for (const { interval, window } of free) {
    const padded = busy.map((block) => ({
      start: new Date(block.start.getTime() - window.buffer_minutes * 60_000),
      end: new Date(block.end.getTime() + window.buffer_minutes * 60_000),
    }))
    for (const gap of subtract([interval], padded)) {
      const step = (window.slot_minutes || durationMinutes) * 60_000
      for (
        let start = gap.start.getTime();
        start + durationMs <= gap.end.getTime();
        start += step
      ) {
        if (start < notBefore.getTime()) continue
        slots.push({
          start: new Date(start).toISOString(),
          end: new Date(start + durationMs).toISOString(),
        })
      }
    }
  }

  // Two windows can produce the same instant (an agent covered by both a
  // personal and an account-wide schedule).
  const unique = new Map<string, Slot>()
  for (const slot of slots.sort((a, b) => a.start.localeCompare(b.start))) {
    if (!unique.has(slot.start)) unique.set(slot.start, slot)
  }
  return [...unique.values()]
}

/** Does a proposed booking collide with anything already on the calendar? */
export function hasOverlap(candidate: Interval, busy: Interval[]): boolean {
  return busy.some((block) => candidate.start < block.end && block.start < candidate.end)
}
