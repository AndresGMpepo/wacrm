import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { compactCallSummary, findLiveCallerCall, loadOwnCallContext, uniqueCallId } from './call-context'
import { callCustomerPhone, isAiReceptionistTranscript, isUsefulCallTranscript } from './call-party'
import { parseTranscriptionArchive } from './transcription-archive'
import { yeastarAiConnection } from './yeastar-ai'

vi.mock('./yeastar-ai', async (original) => ({
  ...await original<typeof import('./yeastar-ai')>(),
  yeastarAiConnection: vi.fn().mockResolvedValue({ pbxUrl: 'https://pbx.example.test', token: 'test-token' }),
}))
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('call party and archive identity', () => {
  it('links an AI-only inbound call to the customer rather than the AI extension', () => {
    expect(callCustomerPhone({ type: 'inbound', call_from: '+525512345678', call_to: '7000' })).toBe('+525512345678')
    expect(callCustomerPhone({ type: 'outbound', call_from: '1001', call_to: '+525512345678' })).toBe('+525512345678')
    expect(callCustomerPhone({ type: 'internal', call_from: '1001', call_to: '7000' })).toBeNull()
  })
  it('labels calls as AI receptionist only when the transcript came from Yeastar AI context', () => {
    expect(isAiReceptionistTranscript({ transcript_source: 'ai_receptionist' })).toBe(true)
    expect(isAiReceptionistTranscript({ ai: { context: [{ data: {} }] } })).toBe(true)
    expect(isAiReceptionistTranscript({ event: { type: 'inbound', call_to: '7000' } })).toBe(false)
  })
  it('hides empty unidentified CDR legs while retaining calls with useful transcript context', () => {
    expect(isUsefulCallTranscript({
      transcript: null, summary: null, agent_user_id: null,
      yeastar_payload: { event: { type: 'inbound' } },
    })).toBe(false)
    expect(isUsefulCallTranscript({
      transcript: null, summary: null, agent_user_id: null,
      yeastar_payload: { transcript_source: 'ai_receptionist' },
    })).toBe(true)
    expect(isUsefulCallTranscript({
      transcript: 'Hola', summary: null, agent_user_id: null, yeastar_payload: {},
    })).toBe(true)
  })
  it('imports official AI receptionist export records chronologically', () => {
    const [record] = parseTranscriptionArchive([{
      uid: 'cdr-root', leg_id: 'leg-1', call_type: 'Inbound', call_from: '+525512345678', call_to: '7000',
      time: '2026/10/05 10:00:00', ai_summary: 'Quiere una cita',
      ai_transcription: [
        { source_number: '525512345678', content: 'Una cita', timestamp: 2 },
        { source_number: '7000', content: '¿Qué necesita?', timestamp: 1 },
      ],
    }])
    expect(record).toMatchObject({ cdrId: 'leg-1', uid: 'cdr-root', direction: 'inbound', phone: '+525512345678' })
    expect(record.transcript).toBe('7000: ¿Qué necesita?\n525512345678: Una cita')
    expect(record.startedAt).toBe('2026-10-05T16:00:00.000Z')
    expect(record.event).toEqual({
      uid: 'cdr-root', leg_id: 'leg-1', call_note_id: 'leg-1',
      call_from: '+525512345678', call_to: '7000', type: 'inbound',
      time_start: '2026/10/05 10:00:00',
    })
    expect(JSON.stringify(record.event)).not.toContain('ai_transcription')
  })
  it('rejects an archive without leg identity and keeps brief histories brief', () => {
    expect(() => parseTranscriptionArchive([{ uid: 'cdr-root', ai_transcription: [] }])).toThrow()
    expect(compactCallSummary('Uno\nDos\nTres\nCuatro')).toBe('Uno\nDos\nTres')
    expect(compactCallSummary('a'.repeat(1000))).toHaveLength(600)
    expect(compactCallSummary(null)).toBeNull()
  })
  it('does not guess which concurrent call is being transferred', () => {
    expect(uniqueCallId([{ call_id: 'a' }, { call_id: 'a' }])).toBe('a')
    expect(uniqueCallId([{ call_id: 'a' }, { call_id: 'b' }])).toBeNull()
  })
})

function database(tables: Record<string, unknown[]>) {
  const urls: URL[] = []
  const db = createClient('https://db.example.test', 'test-key', {
    global: { fetch: async (input) => {
      const url = new URL(String(input))
      urls.push(url)
      return Response.json(tables[url.pathname.split('/').at(-1)!] ?? [])
    } },
  })
  return { db, urls }
}

describe('live handoff association', () => {
  it('uses a static AI extension to identify a unique live caller without asking them to repeat their phone', async () => {
    const { db } = database({})
    const fetcher = vi.fn().mockResolvedValue(Response.json({ errcode: 0, data: [
      { call_id: 'a', members: [
        { extension: { number: '7000', member_status: 'ANSWER' } },
        { inbound: { from: '+525512345678', member_status: 'ANSWERED' } },
      ] },
      { call_id: 'b', members: [
        { extension: { number: '8000', member_status: 'ANSWER' } },
        { inbound: { from: '+525598765432', member_status: 'ANSWERED' } },
      ] },
    ] }))
    vi.stubGlobal('fetch', fetcher)
    expect(await findLiveCallerCall(db, 'account-a', undefined, undefined, '7000')).toEqual({ callId: 'a', phone: '525512345678' })
    expect(yeastarAiConnection).toHaveBeenCalledWith(db, 'account-a')
    expect(fetcher.mock.calls[0][0].searchParams.get('extension')).toBe('7000')
  })
  it('rejects ambiguity and accepts an exact caller to disambiguate', async () => {
    const { db } = database({})
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json({ errcode: 0, data: [
      { call_id: 'a', members: [
        { extension: { number: '7000', member_status: 'ANSWER' } },
        { inbound: { from: '+525512345678', member_status: 'ANSWERED' } },
      ] },
      { call_id: 'b', members: [
        { extension: { number: '7000', member_status: 'ANSWER' } },
        { inbound: { from: '+525598765432', member_status: 'ANSWERED' } },
      ] },
    ] })))
    expect(await findLiveCallerCall(db, 'account-a', undefined, undefined, '7000')).toBeNull()
    expect(await findLiveCallerCall(db, 'account-a', '525512345678', undefined, '7000')).toEqual({ callId: 'a', phone: '525512345678' })
  })
  it('does not reuse a hung-up call or silently ignore a PBX query failure', async () => {
    const { db } = database({})
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ errcode: 0, data: [{
        call_id: 'a', members: [
          { extension: { number: '7000', member_status: 'BYE' } },
          { inbound: { from: '+525512345678', member_status: 'BYE' } },
        ],
      }] }))
      .mockResolvedValueOnce(Response.json({ errcode: 10000 })))
    expect(await findLiveCallerCall(db, 'account-a', undefined, undefined, '7000')).toBeNull()
    await expect(findLiveCallerCall(db, 'account-a', undefined, undefined, '7000')).rejects.toThrow('verificar')
  })

  it('does not expose context from a session not owned by the receiving agent', async () => {
    const { db, urls } = database({
      telephony_user_configs: [{ extension: '1001' }],
      yeastar_live_calls: [{ call_id: 'wacrm:someone-else', peer_number: '+525512345678', channel_id: 'wacrm:someone-else', last_event_at: new Date().toISOString() }],
    })
    expect(await loadOwnCallContext(db, 'account-a', 'agent-a', 'my-session')).toBeNull()
    expect(urls.every((url) => url.searchParams.get('account_id') === 'eq.account-a')).toBe(true)
    expect(urls[1].searchParams.get('extension')).toBe('eq.1001')
  })
  it('separates this-call handoff from historical memory and pending commitments', async () => {
    const { db, urls } = database({
      telephony_user_configs: [{ extension: '1001' }],
      yeastar_live_calls: [
        { call_id: 'wacrm:session-1', peer_number: '+525512345678', channel_id: 'wacrm:session-1', last_event_at: new Date().toISOString() },
        { call_id: 'pbx-1', peer_number: '+525512345678', channel_id: 'pbx-channel', last_event_at: new Date().toISOString() },
      ],
      contacts: [{ id: 'contact-1', name: 'Ana', phone: '+525512345678', alternate_phones: [] }],
      yeastar_call_handoffs: [{ summary: 'Necesita reagendar mañana', customer_need: 'Reagendar', next_action: 'Buscar horario' }],
      contact_memory: [{ current_summary: 'Ya tuvo una consulta', next_best_action: 'Revisar evolución' }],
      contact_commitments: [{ description: 'Enviar indicaciones' }],
      yeastar_call_transcriptions: [{
        summary: 'Llamó para pedir informes.', started_at: new Date(Date.now() - 120_000).toISOString(),
        created_at: new Date(Date.now() - 120_000).toISOString(), direction: 'inbound',
      }],
      conversations: [{
        id: 'conversation-1', channel_type: 'whatsapp', last_message_text: 'Hola, necesito cambiar mi cita.',
        last_message_at: new Date(Date.now() - 60_000).toISOString(),
      }],
      ai_conversation_analyses: [{ summary: 'La clienta pidió cambiar su cita y espera opciones por la tarde.', status: 'completed' }],
    })
    const context = await loadOwnCallContext(db, 'account-a', 'agent-a', 'session-1')
    expect(context).toMatchObject({
      current: { summary: 'Necesita reagendar mañana' }, history: 'Ya tuvo una consulta',
      commitments: ['Enviar indicaciones'], contact: { id: 'contact-1', name: 'Ana', phone: '+525512345678' },
      latestInteraction: {
        channel: 'whatsapp', summary: 'La clienta pidió cambiar su cita y espera opciones por la tarde.',
      },
      callerNumber: '+525512345678',
    })
    expect(urls.find((url) => url.pathname.endsWith('yeastar_call_handoffs'))?.searchParams.get('call_id')).toBe('eq.pbx-1')
  })
})
