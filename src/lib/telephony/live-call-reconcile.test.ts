import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { isStaleSoftphoneCall, reconcileYeastarLiveCalls } from './live-call-reconcile'

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (value: string) => value }))
afterEach(() => vi.unstubAllGlobals())

describe('isStaleSoftphoneCall', () => {
  it('treats a PBX-originated row as never stale by this check', () => {
    expect(isStaleSoftphoneCall({ channel_id: 'leg-1', last_event_at: new Date(0).toISOString() })).toBe(false)
  })
  it('treats a softphone row as stale once its 15s heartbeat is older than 45s', () => {
    const now = Date.now()
    expect(isStaleSoftphoneCall({ channel_id: 'wacrm:call-1', last_event_at: new Date(now - 46_000).toISOString() }, now)).toBe(true)
    expect(isStaleSoftphoneCall({ channel_id: 'wacrm:call-1', last_event_at: new Date(now - 10_000).toISOString() }, now)).toBe(false)
  })
})

describe('reconcileYeastarLiveCalls', () => {
  it('does nothing without OpenAPI credentials configured', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const db = createClient('https://db.example.test', 'test-key')
    await reconcileYeastarLiveCalls(db, 'account-a', [{ call_id: 'call-1', extension: '7000', channel_id: 'leg-1' }], null, null, null)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does nothing when every tracked row is already a softphone call', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const db = createClient('https://db.example.test', 'test-key')
    await reconcileYeastarLiveCalls(db, 'account-a', [{ call_id: 'wacrm:call-1', extension: '7000', channel_id: 'wacrm:call-1' }], 'https://pbx.example.test', 'client-id', 'client-secret')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("deletes a stale row whose extension Yeastar's own live query no longer reports", async () => {
    const fetcher = vi.fn().mockImplementation(async (input: URL) => {
      const url = String(input)
      if (url.includes('get_token')) return Response.json({ errcode: 0, access_token: 'token-1', access_token_expire_time: 1800 })
      if (url.includes('call/query')) {
        return Response.json({ errcode: 0, data: [{ members: [{ extension: { number: '7000', member_status: 'ANSWER' } }] }] })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const deletedKeys: string[] = []
    const db = createClient('https://db.example.test', 'test-key', { global: { fetch: async (input) => {
      const url = new URL(String(input))
      deletedKeys.push(`${url.searchParams.get('call_id')}:${url.searchParams.get('extension')}`)
      return Response.json([])
    } } })
    await reconcileYeastarLiveCalls(db, 'account-a', [
      { call_id: 'call-1', extension: '7000', channel_id: 'leg-1' },
      { call_id: 'call-2', extension: '7001', channel_id: 'leg-2' },
    ], 'https://pbx.example.test', 'client-id', 'client-secret')
    expect(deletedKeys).toEqual(['eq.call-2:eq.7001'])
  })

  it('never deletes a softphone-originated row even if Yeastar reports nothing active', async () => {
    const fetcher = vi.fn().mockImplementation(async (input: URL) => {
      const url = String(input)
      if (url.includes('get_token')) return Response.json({ errcode: 0, access_token: 'token-1', access_token_expire_time: 1800 })
      return Response.json({ errcode: 0, data: [] })
    })
    vi.stubGlobal('fetch', fetcher)
    const databaseFetch = vi.fn()
    const db = createClient('https://db.example.test', 'test-key', { global: { fetch: databaseFetch } })
    await reconcileYeastarLiveCalls(db, 'account-a', [
      { call_id: 'wacrm:call-1', extension: '7000', channel_id: 'wacrm:call-1' },
    ], 'https://pbx.example.test', 'client-id', 'client-secret')
    expect(databaseFetch).not.toHaveBeenCalled()
  })
})
