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
    expect(await syncTranscriptionArchive(db, 'account-a')).toEqual({ imported: 100, remaining: 101 })
    expect(await syncTranscriptionArchive(db, 'account-a')).toEqual({ imported: 100, remaining: 1 })
    expect(await syncTranscriptionArchive(db, 'account-a')).toEqual({ imported: 1, remaining: 0 })
    expect(await syncTranscriptionArchive(db, 'account-a')).toEqual({ imported: 0, remaining: 0 })
    expect(stored.size).toBe(201)
    expect([...stored.values()].every((row) => row.analysis_status === 'pending')).toBe(true)
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
    await expect(syncTranscriptionArchive(db, 'account-a')).rejects.toMatchObject({ message: 'write failed' })
  })
  it('rejects an unrecognized historical call date instead of treating it as today', () => {
    expect(() => parseTranscriptionArchive([{ ...record(1), time: '05/10/2026 10:00:00' }])).toThrow('fecha')
  })
})
