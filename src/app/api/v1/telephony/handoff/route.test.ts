import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { unauthorized } from '@/lib/api/v1/respond'
import { POST } from './route'

const mocks = vi.hoisted(() => ({ key: vi.fn(), entitlement: vi.fn(), live: vi.fn() }))
vi.mock('@/lib/auth/api-context', () => ({ requireApiKey: mocks.key }))
vi.mock('@/lib/account/entitlements', () => ({ getAccountEntitlements: mocks.entitlement }))
vi.mock('@/lib/telephony/call-context', () => ({ findLiveCallerCall: mocks.live }))

let writes: Record<string, unknown>[]
beforeEach(() => {
  vi.resetAllMocks()
  writes = []
  const db = createClient('https://db.example.test', 'test-key', { global: {
    fetch: async (_input, init) => {
      if (init?.body) writes.push(JSON.parse(String(init.body)))
      return Response.json([])
    },
  } })
  mocks.key.mockResolvedValue({ accountId: 'account-from-key', supabase: db })
  mocks.entitlement.mockResolvedValue({ features: { yeastar_telephony: true } })
  mocks.live.mockResolvedValue({ callId: 'verified-pbx-call', phone: '525512345678' })
})
const request = (body: unknown) => new Request('https://app.example.test/api/v1/telephony/handoff', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

describe('AI receptionist handoff API', () => {
  it('requires the dedicated scope and uses only the account resolved from the API key', async () => {
    const response = await POST(request({ account_id: 'forged-account', ai_extension: '7000', summary: 'Necesita reagendar' }))
    expect(response.status).toBe(200)
    expect(mocks.key).toHaveBeenCalledWith(expect.any(Request), 'call-context:write')
    expect(writes[0]).toMatchObject({ account_id: 'account-from-key', call_id: 'verified-pbx-call', summary: 'Necesita reagendar' })
    expect(await response.json()).toMatchObject({ data: { saved: true } })
  })
  it('does not accept a summary for an ambiguous or unverified live call', async () => {
    mocks.live.mockResolvedValue(null)
    expect((await POST(request({ ai_extension: '7000', summary: 'Reagendar' }))).status).toBe(400)
    expect(writes).toHaveLength(0)
  })
  it('rejects oversized summaries', async () => {
    expect((await POST(request({ ai_extension: '7000', summary: 'a'.repeat(801) }))).status).toBe(400)
    expect(mocks.live).not.toHaveBeenCalled()
  })
  it.each(['invalid', '', 123, '+52'])('rejects malformed caller phone %s rather than ignoring it', async (customer_phone) => {
    expect((await POST(request({ customer_phone, ai_extension: '7000', summary: 'Reagendar' }))).status).toBe(400)
    expect(mocks.live).not.toHaveBeenCalled()
  })
  it('rejects unauthenticated requests before any live-call lookup', async () => {
    mocks.key.mockRejectedValue(unauthorized())
    expect((await POST(request({ ai_extension: '7000', summary: 'Reagendar' }))).status).toBe(401)
    expect(mocks.live).not.toHaveBeenCalled()
  })
  it('enforces the account telephony entitlement', async () => {
    mocks.entitlement.mockResolvedValue({ features: { yeastar_telephony: false } })
    expect((await POST(request({ ai_extension: '7000', summary: 'Reagendar' }))).status).toBe(403)
    expect(mocks.live).not.toHaveBeenCalled()
  })
})
