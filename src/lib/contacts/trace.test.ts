import { describe, expect, it } from 'vitest'

import { contactTraceCsv, type TraceEvent } from './trace'

function event(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    at: '2026-01-15T10:00:00.000Z',
    type: 'assignment',
    agent: 'Ana Ruiz',
    agent_id: 'user-1',
    channel: 'whatsapp',
    conversation_id: 'conv-1',
    detail: 'Asignada a Ana Ruiz (asignación automática)',
    ...overrides,
  }
}

describe('contactTraceCsv', () => {
  it('writes a header and one row per event', () => {
    const csv = contactTraceCsv([event(), event({ type: 'call', channel: 'telefonía' })])
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('fecha,evento,agente,contacto,canal,conversacion,detalle')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('"Ana Ruiz"')
  })

  it('escapes quotes and keeps commas inside a single field', () => {
    const csv = contactTraceCsv([event({ detail: 'Dijo "urgente", pidió cotización' })])
    expect(csv).toContain('"Dijo ""urgente"", pidió cotización"')
    expect(csv.split('\r\n')).toHaveLength(2)
  })

  it('neutralizes spreadsheet formulas', () => {
    const csv = contactTraceCsv([event({ agent: '=1+1', detail: '@SUM(A1)' })])
    expect(csv).toContain('"\'=1+1"')
    expect(csv).toContain('"\'@SUM(A1)"')
  })

  it('renders missing values as empty fields', () => {
    const csv = contactTraceCsv([event({ agent: null, channel: null, conversation_id: null })])
    expect(csv.split('\r\n')[1]).toContain('"","",""')
  })
})
