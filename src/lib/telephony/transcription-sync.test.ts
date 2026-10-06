import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { processCallTranscriptions } from './transcription-sync'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(), detail: vi.fn(), analyze: vi.fn(), memory: vi.fn(), contact: vi.fn(),
}))
vi.mock('./yeastar-ai', () => ({ fetchAiResult: mocks.fetch, fetchCdrDetail: mocks.detail }))
vi.mock('./call-summary', () => ({ analyzeCall: mocks.analyze }))
vi.mock('@/lib/ai/memory', () => ({ applyContactMemory: mocks.memory }))
vi.mock('@/lib/api/v1/contacts', () => ({ resolveAuditUserId: async () => 'owner-1' }))
vi.mock('@/lib/whatsapp/resolve-conversation', () => ({ findOrCreateContactByPhone: mocks.contact }))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.fetch.mockResolvedValue({ transcript: 'Necesito seguimiento', cdrId: 'leg-1', raw: {} })
  mocks.detail.mockResolvedValue(null)
  mocks.analyze.mockResolvedValue({ summary: 'Seguimiento solicitado', key_points: [], action_items: [], memory: {} })
  mocks.memory.mockResolvedValue(undefined)
  mocks.contact.mockResolvedValue({ contactId: 'contact-1' })
})

function database(transcript: string | null, allowClaim = true) {
  const writes: Record<string, unknown>[] = []
  const row = {
    id: 'row-1', account_id: 'account-1', call_id: 'call-1', contact_id: null,
    customer_phone: '7000', transcript, summary: null, created_at: new Date().toISOString(),
    started_at: '2026-10-01T16:00:00.000Z',
    yeastar_payload: { event: { type: 'inbound', call_from: '+525512345678', call_to: '7000', call_note_id: 'leg-1' } },
  }
  const db = createClient('https://db.example.test', 'test-key', {
    global: { fetch: async (input, init) => {
      if (init?.method === 'PATCH') {
        const patch = JSON.parse(String(init.body)) as Record<string, unknown>
        writes.push(patch)
        return Response.json(patch.sync_claimed_at && Object.keys(patch).length === 1
          ? (allowClaim ? [{ id: row.id }] : []) : [])
      }
      if (String(input).includes('telephony_user_configs')) return Response.json([])
      return Response.json([row])
    } },
  })
  return { db, writes }
}

describe('call transcription and Nexo Memory pipeline', () => {
  it('persists the transcript before analysis and links an AI-only call to its external customer', async () => {
    const { db, writes } = database(null)
    expect(await processCallTranscriptions(db)).toMatchObject({ completed: 1, failed: 0 })
    expect(writes.find((patch) => patch.transcript)).toMatchObject({ transcript: 'Necesito seguimiento', transcription_status: 'completed' })
    expect(mocks.contact).toHaveBeenCalledWith(db, 'account-1', '525512345678', null, 'owner-1')
    expect(mocks.analyze).toHaveBeenCalledWith(db, 'account-1', 'Necesito seguimiento', '2026-10-01T16:00:00.000Z')
    expect(mocks.memory).toHaveBeenCalledWith(db, {
      accountId: 'account-1', contactId: 'contact-1', source: { type: 'call', id: 'row-1' },
      sourceDate: '2026-10-01T16:00:00.000Z',
    }, expect.anything(), expect.anything())
    expect(writes.at(-1)).toMatchObject({ analysis_status: 'completed', sync_claimed_at: null })
    expect(writes.at(-1)?.memory_applied_at).toBeTruthy()
    expect(writes.find((patch) => patch.transcript)?.yeastar_payload).toMatchObject({ transcript_source: 'ai_receptionist' })
    expect(writes.find((patch) => patch.agent_extension)?.agent_extension).toBe('7000')
  })

  it('keeps the transcript and schedules a retry if memory fails', async () => {
    mocks.memory.mockRejectedValue(new Error('Memory temporarily unavailable'))
    const { db, writes } = database('Transcript already saved')
    expect(await processCallTranscriptions(db)).toMatchObject({ failed: 1, completed: 0 })
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(writes.at(-1)).toMatchObject({ analysis_status: 'failed', sync_claimed_at: null })
    expect(writes.at(-1)?.next_sync_at).toBeTruthy()
    expect(writes.some((patch) => patch.transcript === null)).toBe(false)
  })

  it('does not pretend memory was updated when account AI is not configured', async () => {
    mocks.analyze.mockResolvedValue(null)
    const { db, writes } = database('Transcript already saved')
    expect(await processCallTranscriptions(db)).toMatchObject({ unavailable: 1 })
    expect(mocks.memory).not.toHaveBeenCalled()
    expect(writes.at(-1)).toMatchObject({ analysis_status: 'unavailable' })
  })

  it('avoids processing a job claimed by another worker', async () => {
    const { db } = database(null, false)
    expect(await processCallTranscriptions(db)).toMatchObject({ completed: 0, failed: 0 })
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.analyze).not.toHaveBeenCalled()
  })
})
