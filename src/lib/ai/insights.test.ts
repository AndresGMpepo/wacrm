import { describe, expect, it } from 'vitest'

import { matchDepartmentQueue, parseConversationInsights } from './insights'

describe('parseConversationInsights', () => {
  it('reads a nested insights object', () => {
    const result = parseConversationInsights({
      summary: 'x',
      insights: {
        intent: 'soporte_tecnico',
        sub_intent: 'falla_de_conexion',
        need: 'Restablecer el servicio',
        urgency: 'high',
        lead_temperature: 'warm',
        commercial_opportunity: true,
        recommended_department: 'Soporte',
        handoff_required: true,
        handoff_reason: 'Requiere revisión en sitio',
        customer_context_update: ['Tiene 3 sucursales', 'Factura a nombre de ACME'],
        missing_information: ['Número de cliente'],
      },
    })

    expect(result.intent).toBe('soporte_tecnico')
    expect(result.urgency).toBe('high')
    expect(result.lead_temperature).toBe('warm')
    expect(result.handoff_required).toBe(true)
    expect(result.customer_context_update).toHaveLength(2)
    expect(result.missing_information).toEqual(['Número de cliente'])
  })

  it('reads a flat document when the model skips the wrapper', () => {
    const result = parseConversationInsights({ intent: 'cotizacion', urgency: 'critical' })
    expect(result.intent).toBe('cotizacion')
    expect(result.urgency).toBe('critical')
  })

  it('drops values outside the allowed vocabulary', () => {
    const result = parseConversationInsights({ urgency: 'urgentísimo', lead_temperature: 'boiling' })
    expect(result.urgency).toBeNull()
    expect(result.lead_temperature).toBeNull()
  })

  it('treats empty strings and the literal "null" as missing', () => {
    const result = parseConversationInsights({ intent: '  ', company: 'null', customer_name: '-' })
    expect(result.intent).toBeNull()
    expect(result.company).toBeNull()
    expect(result.customer_name).toBeNull()
  })

  it('defaults handoff_required to false rather than null', () => {
    expect(parseConversationInsights({}).handoff_required).toBe(false)
    expect(parseConversationInsights({ handoff_required: 'true' }).handoff_required).toBe(true)
  })

  it('caps list fields so one verbose answer cannot flood the record', () => {
    const result = parseConversationInsights({
      customer_context_update: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    })
    expect(result.customer_context_update).toHaveLength(5)
  })
})

describe('matchDepartmentQueue', () => {
  const queues = [
    { id: 'q1', name: 'Ventas' },
    { id: 'q2', name: 'Soporte técnico' },
  ]

  it('matches ignoring case and accents', () => {
    expect(matchDepartmentQueue(queues, 'ventas')).toBe('q1')
    expect(matchDepartmentQueue(queues, 'Soporte tecnico')).toBe('q2')
  })

  it('falls back to a prefix match', () => {
    expect(matchDepartmentQueue(queues, 'Soporte')).toBe('q2')
  })

  it('returns null when nothing matches', () => {
    expect(matchDepartmentQueue(queues, 'Cobranza')).toBeNull()
    expect(matchDepartmentQueue(queues, null)).toBeNull()
  })
})
