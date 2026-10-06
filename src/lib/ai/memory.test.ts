import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { applyContactMemory, parseMemoryExtraction } from './memory'

const analysis = { summary: 'Resumen de llamada', sentiment: 'neutral', sentiment_score: 50, next_best_action: 'Contactar' }

function database(options: { previousDate?: string; existingEvent?: boolean; memoryError?: boolean } = {}) {
  const writes: { table: string; value: Record<string, unknown> }[] = []
  const db = createClient('https://db.example.test', 'test-key', {
    global: { fetch: async (input, init) => {
      const url = new URL(String(input))
      const table = url.pathname.split('/').at(-1)!
      if (init?.method === 'POST') {
        if (table === 'contact_memory' && options.memoryError) {
          return Response.json({ code: '42501', message: 'Memory write denied' }, { status: 403 })
        }
        writes.push({ table, value: JSON.parse(String(init.body)) })
        return Response.json([])
      }
      if (table === 'contact_memory') return Response.json(options.previousDate
        ? [{ risk_level: 'low', current_stage: 'cliente', last_source_call_id: 'newer-call' }] : [])
      if (table === 'yeastar_call_transcriptions') return Response.json([{ started_at: options.previousDate }])
      if (table === 'contact_memory_events') return Response.json(options.existingEvent ? [{ id: 'event-1' }] : [])
      return Response.json([])
    } },
  })
  return { db, writes }
}

describe('voice memory persistence', () => {
  it('keeps newer customer context while adding the dated facts from an imported historical call', async () => {
    const { db, writes } = database({ previousDate: '2026-10-05T16:00:00Z' })
    await applyContactMemory(db, {
      accountId: 'account-1', contactId: 'contact-1', source: { type: 'call', id: 'old-call' },
      sourceDate: '2026-10-01T16:00:00Z',
    }, analysis, parseMemoryExtraction({ important_facts: ['Ya acudió a consulta'] }))
    expect(writes.some((write) => write.table === 'contact_memory')).toBe(false)
    expect(writes.find((write) => write.table === 'contact_memory_events')?.value)
      .toMatchObject({ summary: 'Ya acudió a consulta', source_id: 'old-call', event_date: '2026-10-01T16:00:00Z' })
  })

  it('avoids duplicating a call fact when a failed memory job retries', async () => {
    const { db, writes } = database({ existingEvent: true })
    await applyContactMemory(db, {
      accountId: 'account-1', contactId: 'contact-1', source: { type: 'call', id: 'call-1' },
    }, analysis, parseMemoryExtraction({ important_facts: ['Necesita seguimiento'] }))
    expect(writes.filter((write) => write.table === 'contact_memory_events')).toHaveLength(0)
  })

  it('surfaces a database failure instead of reporting that memory was updated', async () => {
    const { db } = database({ memoryError: true })
    await expect(applyContactMemory(db, {
      accountId: 'account-1', contactId: 'contact-1', source: { type: 'call', id: 'call-1' },
    }, analysis, parseMemoryExtraction({}))).rejects.toMatchObject({ code: '42501' })
  })
})
