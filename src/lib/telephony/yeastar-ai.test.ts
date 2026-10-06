import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { aiCdrIds, buildTranscriptFromContext, fetchAiResult, parsePbxLocalTime } from './yeastar-ai'

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (value: string) => value }))

describe('Yeastar transcript parsing', () => {
  it('resolves PBX local date and 12-hour times without shifting historical calls to the import date', () => {
    expect(parsePbxLocalTime('2026/10/05 01:30:00 PM')?.toISOString()).toBe('2026-10-05T19:30:00.000Z')
    expect(parsePbxLocalTime('2026/10/05 12:30:00 AM')?.toISOString()).toBe('2026-10-05T06:30:00.000Z')
    expect(parsePbxLocalTime('2026/02/30 10:00:00')).toBeNull()
    expect(parsePbxLocalTime('10/05/2026 10:00:00')).toBeNull()
  })
  it('uses leg identifiers, never uid or call_id', () => {
    expect(aiCdrIds({ uid: 'record-1', call_id: 'call-1', call_note_id: 'leg-1', legs: [{ leg_id: 'leg-2' }, { leg_id: 'leg-1' }] }))
      .toEqual(['leg-1', 'leg-2'])
    expect(aiCdrIds({ uid: 'record-1', call_id: 'call-1', id: 'wrong-id' })).toEqual([])
  })

  it('orders speaker turns across legs and excludes tool calls and repeated turn ids', () => {
    expect(buildTranscriptFromContext({ data: {
      leg_1: { context: [
        { id: 'a', name: 'AI', type: 'speak', content: '¿Qué necesita?', timestamp: 10 },
        { id: 'tool', type: 'mcp', content: 'transfer()', timestamp: 20 },
      ] },
      leg_2: { context: [
        { id: 'b', source_number: '525512345678', content: 'Una cita', timestamp: 15 },
        { id: 'a', name: 'AI', type: 'speak', content: '¿Qué necesita?', timestamp: 10 },
      ] },
    } })).toBe('AI: ¿Qué necesita?\n525512345678: Una cita')
  })
})

describe('fetchAiResult pagination', () => {
  beforeEach(() => vi.restoreAllMocks())

  function setup(pages: Record<string, unknown>[]) {
    const requests: URL[] = []
    const network = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.includes('/rest/v1/')) {
        return Response.json(url.pathname.endsWith('telephony_configs')
          ? [{ pbx_url: 'https://pbx.example.test' }]
          : [{ api_client_id: 'client', api_client_secret: 'secret' }])
      }
      if (url.pathname.endsWith('get_token')) return Response.json({ errcode: 0, access_token: 'test-token' })
      requests.push(url)
      return Response.json(pages.shift() ?? { errcode: 0, data: {}, offset: -1 })
    })
    vi.stubGlobal('fetch', network)
    return { db: createClient('https://db.example.test', 'test-key'), requests }
  }

  it('fetches every reported page and preserves the customer reply after the first page', async () => {
    const { db, requests } = setup([
      { errcode: 0, offset: 2, data: { leg_1: { context: [{ id: '1', content: 'Hola', timestamp: 1 }] } } },
      { errcode: 0, offset: -1, data: { leg_1: { context: [{ id: '2', content: 'Necesito seguimiento', timestamp: 2 }] } } },
    ])
    const result = await fetchAiResult(db, 'pagination-account', 'call-1', { call_note_id: 'leg-1' })
    expect(result.transcript).toBe('Hola\nNecesito seguimiento')
    expect(requests.map((url) => url.searchParams.get('offset'))).toEqual(['1', '2'])
    expect(requests.every((url) => url.searchParams.get('cdr_ids') === 'leg-1')).toBe(true)
  })

  it('does not persist a success-shaped partial transcript when a later page fails', async () => {
    const { db } = setup([
      { errcode: 0, offset: 2, data: { leg_1: { context: [{ content: 'Hola' }] } } },
      { errcode: 1001, errmsg: 'Not ready' },
    ])
    expect(await fetchAiResult(db, 'error-account', 'call-1', { leg_id: 'leg-1' }))
      .toMatchObject({ transcript: null, contextError: 'Not ready' })
  })

  it('rejects an incorrect/missing leg id before consulting the PBX', async () => {
    const { db, requests } = setup([])
    await expect(fetchAiResult(db, 'missing-account', 'call-1', { uid: 'record-1' })).rejects.toThrow('identificador de tramo')
    expect(requests).toHaveLength(0)
  })
})
