import { beforeEach, describe, expect, it, vi } from 'vitest'
import { analyzeCall, normalizeCallSummary } from './call-summary'
import { createClient } from '@supabase/supabase-js'

const mocks = vi.hoisted(() => ({ config: vi.fn(), generate: vi.fn(), usage: vi.fn() }))
vi.mock('@/lib/ai/config', () => ({ loadAiConfig: mocks.config }))
vi.mock('@/lib/ai/generate', () => ({ generateText: mocks.generate }))
vi.mock('@/lib/ai/usage', () => ({ logAiUsage: mocks.usage }))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.config.mockResolvedValue({ model: 'test', timezone: 'America/Mexico_City', provider: 'openai' })
  mocks.generate.mockResolvedValue({ text: '{"summary":"Seguimiento acordado","action_items":[]}', usage: null })
})

describe('call analysis input', () => {
  it('converts escaped HTML summary output into readable plain text', () => {
    expect(normalizeCallSummary(
      '&lt;p&gt;Resumen&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Cliente necesita seguimiento.&lt;/li&gt;&lt;li&gt;Sin tareas pendientes.&lt;/li&gt;&lt;/ul&gt;',
    )).toBe('- Cliente necesita seguimiento.\n- Sin tareas pendientes.')
    expect(normalizeCallSummary('<p>Resumen</p><ul><li>Cliente pide una llamada.</li></ul>'))
      .toBe('- Cliente pide una llamada.')
  })
  it('includes the closing commitments of a long call and its actual date, not the import date', async () => {
    const transcript = 'Conversación previa. '.repeat(1000) + 'Llámeme mañana a las 3 pm.'
    const db = createClient('https://db.example.test', 'test-key')
    await analyzeCall(db, 'account-1', transcript, '2026-10-01T16:00:00Z')
    const input = mocks.generate.mock.calls[0][0]
    expect(input.messages[0].content).toContain('2026-10-01T16:00:00Z')
    expect(input.messages[0].content).toContain('America/Mexico_City')
    expect(input.messages[0].content).toContain(transcript)
    expect(input.messages[0].content).toContain('Llámeme mañana a las 3 pm.')
  })
  it('does not silently mark invalid model output as completed', async () => {
    mocks.generate.mockResolvedValue({ text: 'No JSON', usage: null })
    const db = createClient('https://db.example.test', 'test-key')
    await expect(analyzeCall(db, 'account-1', 'Necesito seguimiento')).rejects.toThrow('resumen')
  })
})
