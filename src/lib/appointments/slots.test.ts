import { describe, expect, it } from 'vitest'

import { computeSlots, hasOverlap, zonedDayInfo, zonedWallClockToUtc, type WeeklyWindow } from './slots'

const MEXICO = 'America/Mexico_City'

function window(overrides: Partial<WeeklyWindow> = {}): WeeklyWindow {
  return {
    weekday: 1, // Monday
    start_time: '09:00',
    end_time: '12:00',
    timezone: 'UTC',
    slot_minutes: 60,
    buffer_minutes: 0,
    ...overrides,
  }
}

describe('zonedWallClockToUtc', () => {
  it('resolves a wall-clock time to the right instant', () => {
    // Mexico City is UTC-6 in January (no DST).
    expect(zonedWallClockToUtc('2026-01-12', '09:00', MEXICO).toISOString()).toBe(
      '2026-01-12T15:00:00.000Z',
    )
  })

  it('follows the zone across a daylight-saving change', () => {
    // Madrid: UTC+1 in winter, UTC+2 in summer. Same wall clock, different instant.
    const winter = zonedWallClockToUtc('2026-01-12', '09:00', 'Europe/Madrid')
    const summer = zonedWallClockToUtc('2026-07-13', '09:00', 'Europe/Madrid')
    expect(winter.toISOString()).toBe('2026-01-12T08:00:00.000Z')
    expect(summer.toISOString()).toBe('2026-07-13T07:00:00.000Z')
  })
})

describe('zonedDayInfo', () => {
  it('reports the local day, not the UTC one', () => {
    // 03:00 UTC on Tuesday is still Monday evening in Mexico City.
    const info = zonedDayInfo(new Date('2026-01-13T03:00:00.000Z'), MEXICO)
    expect(info.key).toBe('2026-01-12')
    expect(info.weekday).toBe(1)
  })
})

describe('computeSlots', () => {
  const from = new Date('2026-01-12T00:00:00.000Z') // Monday
  const to = new Date('2026-01-13T00:00:00.000Z')

  it('splits a working window into slots of the requested duration', () => {
    const slots = computeSlots({
      windows: [window()],
      busy: [],
      from,
      to,
      durationMinutes: 60,
      notBefore: from,
    })
    expect(slots.map((s) => s.start)).toEqual([
      '2026-01-12T09:00:00.000Z',
      '2026-01-12T10:00:00.000Z',
      '2026-01-12T11:00:00.000Z',
    ])
  })

  it('removes slots taken by an existing appointment', () => {
    const slots = computeSlots({
      windows: [window()],
      busy: [{ start: new Date('2026-01-12T10:00:00.000Z'), end: new Date('2026-01-12T11:00:00.000Z') }],
      from,
      to,
      durationMinutes: 60,
      notBefore: from,
    })
    expect(slots.map((s) => s.start)).toEqual([
      '2026-01-12T09:00:00.000Z',
      '2026-01-12T11:00:00.000Z',
    ])
  })

  it('keeps the buffer clear around a booking', () => {
    const slots = computeSlots({
      windows: [window({ buffer_minutes: 30 })],
      busy: [{ start: new Date('2026-01-12T10:00:00.000Z'), end: new Date('2026-01-12T10:30:00.000Z') }],
      from,
      to,
      durationMinutes: 60,
      notBefore: from,
    })
    // 09:00 ends at 10:00 but the buffer starts at 09:30, so only 11:00 fits.
    expect(slots.map((s) => s.start)).toEqual(['2026-01-12T11:00:00.000Z'])
  })

  it('ignores days that are not in the schedule', () => {
    const slots = computeSlots({
      windows: [window({ weekday: 3 })], // Wednesday
      busy: [],
      from,
      to,
      durationMinutes: 60,
      notBefore: from,
    })
    expect(slots).toEqual([])
  })

  it('drops slots that already started', () => {
    const slots = computeSlots({
      windows: [window()],
      busy: [],
      from,
      to,
      durationMinutes: 60,
      notBefore: new Date('2026-01-12T10:30:00.000Z'),
    })
    expect(slots.map((s) => s.start)).toEqual(['2026-01-12T11:00:00.000Z'])
  })

  it('does not offer a slot that would run past the closing time', () => {
    const slots = computeSlots({
      windows: [window({ end_time: '10:30' })],
      busy: [],
      from,
      to,
      durationMinutes: 60,
      notBefore: from,
    })
    expect(slots.map((s) => s.start)).toEqual(['2026-01-12T09:00:00.000Z'])
  })

  it('interprets the schedule in its own timezone', () => {
    const slots = computeSlots({
      windows: [window({ timezone: MEXICO, start_time: '09:00', end_time: '10:00' })],
      busy: [],
      from: new Date('2026-01-12T00:00:00.000Z'),
      to: new Date('2026-01-13T12:00:00.000Z'),
      durationMinutes: 60,
      notBefore: new Date('2026-01-12T00:00:00.000Z'),
    })
    expect(slots.map((s) => s.start)).toEqual(['2026-01-12T15:00:00.000Z'])
  })

  it('returns nothing when the resource has no schedule', () => {
    expect(computeSlots({ windows: [], busy: [], from, to, durationMinutes: 30 })).toEqual([])
  })
})

describe('hasOverlap', () => {
  const busy = [{ start: new Date('2026-01-12T10:00:00Z'), end: new Date('2026-01-12T11:00:00Z') }]

  it('detects a booking that lands inside another', () => {
    expect(
      hasOverlap({ start: new Date('2026-01-12T10:30:00Z'), end: new Date('2026-01-12T11:30:00Z') }, busy),
    ).toBe(true)
  })

  it('allows a booking that starts exactly when the other ends', () => {
    expect(
      hasOverlap({ start: new Date('2026-01-12T11:00:00Z'), end: new Date('2026-01-12T12:00:00Z') }, busy),
    ).toBe(false)
  })
})
