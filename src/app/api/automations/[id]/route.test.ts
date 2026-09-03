import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  requireRole: vi.fn(),
  admin: vi.fn(),
  loadStepsTree: vi.fn(),
  replaceSteps: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: mocks.getCurrentAccount,
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'Forbidden' }, { status: 403 })),
}))

vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: mocks.admin }))
vi.mock('@/lib/automations/steps-tree', () => ({
  loadStepsTree: mocks.loadStepsTree,
  replaceSteps: mocks.replaceSteps,
}))
vi.mock('@/lib/automations/channels', () => ({ normalizeChannelTypes: vi.fn(() => null) }))
vi.mock('@/lib/automations/validate', () => ({
  validateStepsForActivation: vi.fn(() => []),
  validateTriggerForActivation: vi.fn(() => []),
}))

import { DELETE, GET, PATCH } from './route'

const account = { accountId: 'account-a', userId: 'user-a', role: 'admin', account: { id: 'account-a', name: 'Acme' }, supabase: {} }
const params = { params: Promise.resolve({ id: 'automation-b' }) }

function makeAdmin(row: Record<string, unknown> | null = null) {
  const eqCalls: Array<[string, unknown]> = []
  const from = vi.fn(() => {
    const builder: Record<string, unknown> = {}
    const chain = () => builder
    for (const method of ['select', 'update', 'delete']) builder[method] = vi.fn(chain)
    builder.eq = vi.fn((column: string, value: unknown) => {
      eqCalls.push([column, value])
      return builder
    })
    builder.maybeSingle = vi.fn(async () => ({ data: row, error: null }))
    builder.then = (resolve: (value: unknown) => unknown) => resolve({ error: null })
    return builder
  })
  return { client: { from }, eqCalls, from }
}

beforeEach(() => {
  mocks.getCurrentAccount.mockReset()
  mocks.requireRole.mockReset()
  mocks.loadStepsTree.mockReset()
  mocks.replaceSteps.mockReset()
  mocks.getCurrentAccount.mockResolvedValue(account)
  mocks.requireRole.mockResolvedValue(account)
  mocks.loadStepsTree.mockResolvedValue([])
})

describe('/api/automations/[id]', () => {
  it('returns 404 for a foreign automation and never loads its steps', async () => {
    const admin = makeAdmin(null)
    mocks.admin.mockReturnValue(admin.client)

    const response = await GET(new Request('http://localhost/api/automations/automation-b'), params)

    expect(response.status).toBe(404)
    expect(admin.eqCalls).toEqual(expect.arrayContaining([['id', 'automation-b'], ['account_id', 'account-a']]))
    expect(mocks.loadStepsTree).not.toHaveBeenCalled()
  })

  it('scopes an update to the active account even after authorization', async () => {
    const admin = makeAdmin({ id: 'automation-a', account_id: 'account-a', is_active: false, trigger_type: 'manual', trigger_config: {} })
    mocks.admin.mockReturnValue(admin.client)

    const response = await PATCH(
      new Request('http://localhost/api/automations/automation-a', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Updated' }) }),
      { params: Promise.resolve({ id: 'automation-a' }) },
    )

    expect(response.status).toBe(200)
    expect(admin.eqCalls).toEqual(expect.arrayContaining([['id', 'automation-a'], ['account_id', 'account-a']]))
  })

  it('scopes deletion to the active account', async () => {
    const admin = makeAdmin()
    mocks.admin.mockReturnValue(admin.client)

    const response = await DELETE(new Request('http://localhost/api/automations/automation-b', { method: 'DELETE' }), params)

    expect(response.status).toBe(200)
    expect(admin.eqCalls).toEqual(expect.arrayContaining([['id', 'automation-b'], ['account_id', 'account-a']]))
  })
})