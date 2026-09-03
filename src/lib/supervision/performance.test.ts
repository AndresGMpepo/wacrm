import { describe, expect, it } from 'vitest'

import { agentPerformanceCsv, type AgentPerformanceRow } from './performance'

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
    ...overrides,
  }
}

describe('agentPerformanceCsv', () => {
  it('writes a header and one row per agent', () => {
    const csv = agentPerformanceCsv([row(), row({ user_id: 'u2', agent: 'Luis Paz' })])
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe(
      'agente,mensajes_enviados,conversaciones_atendidas,conversaciones_cerradas,transferencias_enviadas,transferencias_recibidas,llamadas,notas,citas_creadas,etiquetas_aplicadas',
    )
    expect(lines).toHaveLength(3)
    expect(lines[2]).toContain('"Luis Paz"')
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
