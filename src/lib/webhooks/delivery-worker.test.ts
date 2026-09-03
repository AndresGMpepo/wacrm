import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const mocks = vi.hoisted(() => ({ isDeliverableUrl: vi.fn() }))

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: vi.fn((value: string) => value) }))
vi.mock('@/lib/webhooks/ssrf', () => ({ isDeliverableUrl: mocks.isDeliverableUrl }))
vi.mock('@/lib/webhooks/n8n-delivery-log', () => ({ recordN8nDelivery: vi.fn() }))

import { processWebhookDeliveryJobs } from './delivery-worker'

const job = {
  id: 'job-1',
  account_id: 'account-1',
  endpoint_id: 'endpoint-1',
  delivery_id: '00000000-0000-4000-8000-000000000001',
  event_type: 'message.received',
  payload: '{"id":"00000000-0000-4000-8000-000000000001"}',
  attempt_count: 0,
}

function makeDb(claimed: boolean) {
  const updates: Array<Record<string, unknown>> = []
  let jobTableCalls = 0
  const from = (table: string) => {
    let payload: Record<string, unknown> = {}
    const builder: Record<string, unknown> = {}
    const chain = () => builder
    for (const method of ['eq', 'lt', 'lte', 'order', 'limit']) builder[method] = vi.fn(chain)
    builder.select = vi.fn(() => {
      return builder
    })
    builder.update = vi.fn((next: Record<string, unknown>) => {
      payload = next
      updates.push(payload)
      return builder
    })
    builder.maybeSingle = vi.fn(async () => {
      if (table === 'webhook_delivery_jobs' && jobTableCalls === 2) {
        return { data: claimed ? { id: job.id } : null, error: null }
      }
      if (table === 'webhook_endpoints') return { data: { id: 'endpoint-1', account_id: 'account-1', is_active: false }, error: null }
      return { data: null, error: null }
    })
    builder.then = (resolve: (result: unknown) => unknown) => {
      if (table === 'webhook_delivery_jobs') {
        const call = jobTableCalls++
        if (call === 1) return resolve({ data: [job], error: null })
      }
      return resolve({ data: null, error: null })
    }
    return builder
  }
  return { db: { from } as unknown as SupabaseClient, updates }
}

beforeEach(() => {
  mocks.isDeliverableUrl.mockReset()
  vi.stubGlobal('fetch', vi.fn())
})

describe('processWebhookDeliveryJobs', () => {
  it('marks an inactive endpoint skipped after one worker claims the job', async () => {
    const { db, updates } = makeDb(true)

    const result = await processWebhookDeliveryJobs(db)

    expect(result).toEqual({ delivered: 0, retried: 0, deadLetters: 0, skipped: 1 })
    expect(updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'processing' }),
      expect.objectContaining({ status: 'skipped' }),
    ]))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not deliver when another worker already claimed the job', async () => {
    const { db, updates } = makeDb(false)

    const result = await processWebhookDeliveryJobs(db)

    expect(result).toEqual({ delivered: 0, retried: 0, deadLetters: 0, skipped: 0 })
    expect(updates).toEqual([expect.objectContaining({ status: 'queued' }), expect.objectContaining({ status: 'processing' })])
    expect(fetch).not.toHaveBeenCalled()
  })
})