import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { parseTranscriptionArchive, syncTranscriptionArchive } from './transcription-archive'

vi.mock('./yeastar-ai', async (original) => ({
  ...await original<typeof import('./yeastar-ai')>(),
  yeastarAiConnection: vi.fn().mockResolvedValue({ pbxUrl: 'https://pbx.example.test', token: 'test-token' }),
}))
afterEach(() => vi.unstubAllGlobals())

const record = (index: number) => ({
  uid: `root-${index}`, leg_id: `leg-${index}`, time: '2026/10/05 10:00:00',
  call_type: 'Inbound', call_from: '+525512345678', call_to: '7000',
  ai_transcription: [{ source_number: '+525512345678', content: `Necesito seguimiento ${index}`, timestamp: index }],
})
function upstream(rows: unknown, resource = '/api/download/transcripts.json') {
  const fetcher = vi.fn().mockImplementation(async (input: URL) => input.pathname.includes('aidownload')
    ? Response.json({ errcode: 0, download_resource_url: resource })
    : Response.json(rows))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

describe('Yeastar archive synchronization', () => {
  it('imports exactly 100 legs per batch and continues past records already awaiting analysis', async () => {
    upstream(Array.from({ length: 201 }, (_, i) => record(i)))
    const stored = new Map<string, Record<string, unknown>>()
    const db = createClient('https://db.example.test', 'test-key', { global: { fetch: async (input, init) => {
      const url = new URL(String(input))
      expect(url.searchParams.get('account_id') ?? (init?.body ? 'eq.account-a' : null)).toBe('eq.account-a')
      if (init?.method === 'POST') {
        const rows = JSON.parse(String(init.body)) as Record<string, unknown>[]
        rows.forEach((row) => stored.set(String(row.cdr_id), { id: String(row.cdr_id), ...row }))
        return Response.json([])
      }
      const ids = url.searchParams.get('cdr_id')!.slice(4, -1).split(',').map((id) => id.replaceAll('"', ''))
      expect(ids.length).toBeLessThanOrEqual(100)
      return Response.json(ids.flatMap((id) => stored.has(id) ? [stored.get(id)] : []))
    } } })
    expect(await syncTranscriptionArchive(db, 'account-a')).toEqual({ imported: 100, updated: 0, dated: 0, remaining: 101, available: 201, alreadyPresent: 0, undated: 0 })
    expect(await syncTranscriptionArchive(db, 'account-a')).toEqual({ imported: 100, updated: 0, dated: 0, remaining: 1, available: 201, alreadyPresent: 100, undated: 0 })
    expect(await syncTranscriptionArchive(db, 'account-a')).toEqual({ imported: 1, updated: 0, dated: 0, remaining: 0, available: 201, alreadyPresent: 200, undated: 0 })
    expect(await syncTranscriptionArchive(db, 'account-a')).toEqual({ imported: 0, updated: 0, dated: 0, remaining: 0, available: 201, alreadyPresent: 201, undated: 0 })
    expect(stored.size).toBe(201)
    expect([...stored.values()].every((row) => row.analysis_status === 'pending')).toBe(true)
    expect([...stored.values()].every((row) =>
      (row.yeastar_payload as { transcript_source: string }).transcript_source === 'ai_receptionist')).toBe(true)
  })
  it('rejects a download on another origin before forwarding credentials', async () => {
    const fetcher = upstream([], 'https://other.example.test/api/download/file')
    await expect(syncTranscriptionArchive(createClient('https://db.example.test', 'test-key'), 'account-a')).rejects.toThrow('dirección')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('rejects an oversized archive rather than storing a partial result', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ errcode: 0, download_resource_url: '/api/download/file' }))
      .mockResolvedValueOnce(new Response(new Uint8Array(10 * 1024 * 1024 + 1))))
    const databaseFetch = vi.fn()
    const db = createClient('https://db.example.test', 'test-key', { global: { fetch: databaseFetch } })
    await expect(syncTranscriptionArchive(db, 'account-a')).rejects.toThrow('10 MB')
    expect(databaseFetch).not.toHaveBeenCalled()
  })
  it('does not report imported records if the database write fails', async () => {
    upstream([record(1)])
    const db = createClient('https://db.example.test', 'test-key', { global: { fetch: async (_input, init) =>
      init?.method === 'POST' ? Response.json({ message: 'write failed' }, { status: 500 }) : Response.json([]),
    } })
    await expect(syncTranscriptionArchive(db, 'account-a')).rejects.toMatchObject({
      name: 'TranscriptionArchiveError', code: 'transcript_database_error', status: 500,
    })
  })
  it('replaces a short partial transcript when the completed Yeastar archive has more turns', async () => {
    upstream([record(1)])
    const saved: { value?: Record<string, unknown> } = {}
    const db = createClient('https://db.example.test', 'test-key', { global: { fetch: async (_input, init) => {
      if (init?.method === 'POST') {
        saved.value = JSON.parse(String(init.body))[0]
        return Response.json([])
      }
      return Response.json([{
        id: 'call-1', call_id: 'existing-call', cdr_id: 'leg-1',
        transcript: 'De acuerdo.',
        analysis_status: 'completed', memory_applied_at: '2026-10-05T18:00:00Z',
      }])
    } } })
    expect(await syncTranscriptionArchive(db, 'account-a')).toMatchObject({ imported: 0, updated: 1, remaining: 0 })
    expect(saved.value).toMatchObject({
      call_id: 'existing-call', analysis_status: 'pending', summary: null,
      memory_applied_at: null, transcription_status: 'completed',
    })
    expect(saved.value?.transcript).toBe('+525512345678: Necesito seguimiento 1')
  })
  it('does not replace a transcript with a shorter archive version', async () => {
    upstream([record(1)])
    const databaseFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST' ? Response.json([]) : Response.json([{
        id: 'call-1', call_id: 'existing-call', cdr_id: 'leg-1',
        transcript: 'Esta es una transcripción completa y más larga que el archivo.',
        started_at: '2026-10-05T16:00:00.000Z',
        analysis_status: 'completed',
      }]))
    const db = createClient('https://db.example.test', 'test-key', { global: { fetch: databaseFetch } })
    expect(await syncTranscriptionArchive(db, 'account-a')).toMatchObject({ imported: 0, updated: 0, remaining: 0, alreadyPresent: 1 })
    expect(databaseFetch.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
  })
  it('keeps a transcript when Yeastar provides an unrecognized date without inventing a timestamp', () => {
    const [row] = parseTranscriptionArchive([{ ...record(1), time: '13/05/2026 10:00:00' }])
    expect(row).toMatchObject({
      transcript: '+525512345678: Necesito seguimiento 1',
      startedAt: null,
      dateUnavailable: true,
      event: { time_start: null },
    })
  })
  it('imports transcript rows with unrecognized dates and reports them', async () => {
    upstream([{ ...record(1), time: '13/05/2026 10:00:00' }])
    const saved: { value?: Record<string, unknown> } = {}
    const db = createClient('https://db.example.test', 'test-key', { global: { fetch: async (_input, init) => {
      if (init?.method === 'POST') {
        saved.value = JSON.parse(String(init.body))[0]
        return Response.json([])
      }
      return Response.json([])
    } } })
    expect(await syncTranscriptionArchive(db, 'account-a')).toMatchObject({
      imported: 1, remaining: 0, undated: 1,
    })
    expect(saved.value).toMatchObject({ started_at: null, transcription_status: 'completed' })
  })
  it('repairs dates for previously imported transcripts when the PBX format is recognized', async () => {
    upstream([{ ...record(1), time: '10/05/2026 10:00:00' }])
    const saved: { value?: Record<string, unknown> } = {}
    const db = createClient('https://db.example.test', 'test-key', { global: { fetch: async (_input, init) => {
      if (init?.method === 'POST') {
        saved.value = JSON.parse(String(init.body))[0]
        return Response.json([])
      }
      return Response.json([{
        id: 'call-1', call_id: 'existing-call', cdr_id: 'leg-1',
        transcript: '+525512345678: Necesito seguimiento 1',
        started_at: null, summary: 'Resumen existente', key_points: ['Punto'],
        action_items: [], analysis_status: 'completed', analysis_error: null,
        memory_applied_at: '2026-10-05T18:00:00Z',
      }])
    } } })
    expect(await syncTranscriptionArchive(db, 'account-a')).toMatchObject({
      imported: 0, updated: 0, dated: 1, remaining: 0,
    })
    expect(saved.value).toMatchObject({
      started_at: '2026-10-05T16:00:00.000Z',
      transcript: '+525512345678: Necesito seguimiento 1',
      summary: 'Resumen existente',
      key_points: ['Punto'],
      analysis_status: 'completed',
      memory_applied_at: '2026-10-05T18:00:00Z',
    })
  })
})
