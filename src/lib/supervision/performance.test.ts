import { describe, expect, it } from 'vitest'

import { agentPerformanceCsv, formatDuration, type AgentPerformanceRow } from './performance'

function row(overrides: Partial<AgentPerformanceRow> = {}): AgentPerformanceRow {
  return {
    user_id: 'u1',
    agent: 'Ana Ruiz',
    messages_sent: 12,
    conversations_handled: 5,
    conversations_closed: 3,
    transfers_sent: 1,
    transfers_received: 2,
    calls: 4,
    notes: 6,
    appointments_created: 1,
    tags_applied: 7,
    first_response_median_seconds: 95,
    first_response_samples: 8,
    resolution_median_seconds: 5400,
    resolution_samples: 3,
    online_seconds: 7200,
    ...overrides,
  }
}

describe('agentPerformanceCsv', () => {
  it('writes a header and one row per agent', () => {
    const csv = agentPerformanceCsv([row(), row({ user_id: 'u2', agent: 'Luis Paz' })])
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe(
      'agente,mensajes_enviados,conversaciones_atendidas,conversaciones_cerradas,primera_respuesta_mediana_seg,primera_respuesta_muestras,resolucion_mediana_seg,resolucion_muestras,tiempo_conectado_seg,transferencias_enviadas,transferencias_recibidas,llamadas,notas,citas_creadas,etiquetas_aplicadas',
    )
    expect(lines).toHaveLength(3)
    expect(lines[2]).toContain('"Luis Paz"')
  })

  it('leaves an unmeasured service time empty rather than zero', () => {
    const csv = agentPerformanceCsv([
      row({ first_response_median_seconds: null, resolution_median_seconds: null }),
    ])
    expect(csv.split('\r\n')[1]).toContain('"Ana Ruiz","12","5","3","","8","","3"')
  })

  it('escapes quotes and neutralizes formulas in agent names', () => {
    const csv = agentPerformanceCsv([row({ agent: '=CMD()' }), row({ agent: 'Ana "La Jefa"' })])
    expect(csv).toContain('"\'=CMD()"')
    expect(csv).toContain('"Ana ""La Jefa"""')
  })

  it('keeps zeros as zeros rather than empty cells', () => {
    const csv = agentPerformanceCsv([row({ messages_sent: 0, calls: 0 })])
    expect(csv.split('\r\n')[1]).toContain('"0"')
  })
})

describe('formatDuration', () => {
  it('renders seconds, minutes and hours', () => {
    expect(formatDuration(45)).toBe('45s')
    expect(formatDuration(95)).toBe('1m 35s')
    expect(formatDuration(5400)).toBe('1h 30m')
  })

  it('renders an unmeasured value as a dash', () => {
    expect(formatDuration(null)).toBe('—')
  })
})
