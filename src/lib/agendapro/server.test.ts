import { describe, expect, it } from 'vitest'

import { isAgendaProCancelled } from './server'

describe('isAgendaProCancelled', () => {
  it('detects a cancelled booking by its status name, with or without accents/case', () => {
    expect(isAgendaProCancelled(5, 'Cancelado')).toBe(true)
    expect(isAgendaProCancelled(4, 'cancelada')).toBe(true)
    expect(isAgendaProCancelled(null, 'CANCELADO')).toBe(true)
  })

  it('falls back to both documented cancelled ids only when there is no status name', () => {
    // The bookings list documents 5=Cancelado; the cancel endpoint's own
    // example returns status_id 4 / "Cancelado".
    expect(isAgendaProCancelled(5, null)).toBe(true)
    expect(isAgendaProCancelled(4, '')).toBe(true)
  })

  it('never treats an active status as cancelled', () => {
    expect(isAgendaProCancelled(1, 'Reservado')).toBe(false)
    expect(isAgendaProCancelled(2, 'Confirmado')).toBe(false)
    expect(isAgendaProCancelled(6, 'No Asiste')).toBe(false)
    expect(isAgendaProCancelled(8, 'Pendiente')).toBe(false)
    expect(isAgendaProCancelled(null, null)).toBe(false)
  })
})
