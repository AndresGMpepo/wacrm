import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireEntitlement: vi.fn(),
  createClient: vi.fn(),
  admin: vi.fn(),
}))

vi.mock('@/lib/account/entitlements', () => ({ requireEntitlement: mocks.requireEntitlement }))
vi.mock('@/lib/auth/account', () => ({ toErrorResponse: vi.fn(() => Response.json({ error: 'Forbidden' }, { status: 403 })) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: mocks.admin }))
vi.mock('@/lib/automations/channels', () => ({ normalizeChannelTypes: vi.fn(() => null) }))

import { PUT } from './route'

function scopedClient(flow: Record<string, unknown> | null) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  for (const method of ['select', 'eq']) builder[method] = vi.fn(chain)
  builder.maybeSingle = vi.fn(async () => ({ data: flow, error: null }))
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-a' } }, error: null })) },
    from: vi.fn(() => builder),
  }
}

function adminClient() {
  const rpc = vi.fn(async () => ({ error: null }))
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  for (const method of ['select', 'eq', 'order']) builder[method] = vi.fn(chain)
  builder.maybeSingle = vi.fn(async () => ({ data: { id: 'flow-a' }, error: null }))
  builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null })
  return { client: { rpc, from: vi.fn(() => builder) }, rpc }
}

beforeEach(() => {
  mocks.requireEntitlement.mockReset()
  mocks.createClient.mockReset()
  mocks.admin.mockReset()
  mocks.requireEntitlement.mockResolvedValue({ accountId: 'account-a' })
})

describe('PUT /api/flows/[id]', () => {
  it('saves a graph through the atomic RPC scoped to the authorized account', async () => {
    mocks.createClient.mockResolvedValue(scopedClient({ id: 'flow-a', account_id: 'account-a' }))
    const admin = adminClient()
    mocks.admin.mockReturnValue(admin.client)
    const nodes = [{ node_key: 'start', node_type: 'start', config: { next_node_key: 'end' } }]

    const response = await PUT(
      new Request('http://localhost/api/flows/flow-a', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Nuevo', nodes }) }),
      { params: Promise.resolve({ id: 'flow-a' }) },
    )

    expect(response.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith('replace_flow_graph', expect.objectContaining({
      p_account_id: 'account-a',
      p_flow_id: 'flow-a',
      p_nodes: nodes,
    }))
  })

  it('returns 404 before a service-role write when RLS cannot read the flow', async () => {
    mocks.createClient.mockResolvedValue(scopedClient(null))
    const admin = adminClient()
    mocks.admin.mockReturnValue(admin.client)

    const response = await PUT(
      new Request('http://localhost/api/flows/flow-b', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nodes: [] }) }),
      { params: Promise.resolve({ id: 'flow-b' }) },
    )

    expect(response.status).toBe(404)
    expect(admin.rpc).not.toHaveBeenCalled()
  })
})