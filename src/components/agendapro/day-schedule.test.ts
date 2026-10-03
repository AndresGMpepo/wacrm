import { describe, expect, it } from 'vitest'

import { clockFromMinutes, layoutOverlaps, type ScheduleBooking } from './day-schedule'

function booking(id: number, start: string, end: string): ScheduleBooking {
  return { id, start, end, service: 'Terapia', service_provider_id: 1, status: 'Reservado', client: null }
}

describe('clockFromMinutes', () => {
  it('produces the same "HH:mm" shape as AgendaPro start_block', () => {
    expect(clockFromMinutes(9 * 60)).toBe('09:00')
    expect(clockFromMinutes(10 * 60 + 30)).toBe('10:30')
    expect(clockFromMinutes(0)).toBe('00:00')
  })
})

describe('layoutOverlaps', () => {
  it('puts three simultaneous sessions side by side', () => {
    const laid = layoutOverlaps([
      booking(1, '2026-10-02T10:00:00.000Z', '2026-10-02T11:00:00.000Z'),
      booking(2, '2026-10-02T10:00:00.000Z', '2026-10-02T11:00:00.000Z'),
      booking(3, '2026-10-02T10:30:00.000Z', '2026-10-02T11:30:00.000Z'),
    ])
    expect(laid.map((b) => b.totalCols)).toEqual([3, 3, 3])
    expect(new Set(laid.map((b) => b.col)).size).toBe(3)
  })

  it('gives back-to-back bookings the full width', () => {
    const laid = layoutOverlaps([
      booking(1, '2026-10-02T10:00:00.000Z', '2026-10-02T11:00:00.000Z'),
      booking(2, '2026-10-02T11:00:00.000Z', '2026-10-02T12:00:00.000Z'),
    ])
    expect(laid.map((b) => b.totalCols)).toEqual([1, 1])
  })
})
