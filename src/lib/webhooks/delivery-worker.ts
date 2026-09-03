import type { SupabaseClient } from '@supabase/supabase-js'

import { decrypt } from '@/lib/whatsapp/encryption'
import { buildSignatureHeader } from '@/lib/webhooks/sign'
import { isDeliverableUrl } from '@/lib/webhooks/ssrf'
import { recordN8nDelivery } from '@/lib/webhooks/n8n-delivery-log'
import { DELIVERY_TIMEOUT_MS, MAX_CONSECUTIVE_FAILURES } from '@/lib/webhooks/deliver'

const MAX_ATTEMPTS = 3
const PROCESSING_LEASE_MS = 5 * 60_000

type Job = {
  id: string
  account_id: string
  endpoint_id: string
  delivery_id: string
  event_type: string
  payload: string
  attempt_count: number
}

type Endpoint = {
  id: string
  account_id: string
  url: string
  secret: string
  is_active: boolean
  integration_type: 'generic' | 'n8n'
}

export function retryDelayMs(attemptCount: number): number {
  return Math.min(15 * 60_000, 60_000 * 2 ** Math.max(0, attemptCount - 1))
}

export async function processWebhookDeliveryJobs(db: SupabaseClient): Promise<{
  delivered: number
  retried: number
  deadLetters: number
  skipped: number
}> {
  const now = new Date()
  // A process can die after it claims a job but before it records an
  // outcome. Return only expired leases to the queue so they are retried.
  const { error: recoveryError } = await db
    .from('webhook_delivery_jobs')
    .update({
      status: 'queued',
      next_attempt_at: now.toISOString(),
      last_error: 'El worker anterior no terminó antes de vencer su lease.',
    })
    .eq('status', 'processing')
    .lt('last_attempt_at', new Date(now.getTime() - PROCESSING_LEASE_MS).toISOString())
  if (recoveryError) throw recoveryError

  const { data, error } = await db
    .from('webhook_delivery_jobs')
    .select('id, account_id, endpoint_id, delivery_id, event_type, payload, attempt_count')
    .eq('status', 'queued')
    .lte('next_attempt_at', now.toISOString())
    .order('next_attempt_at')
    .limit(25)
  if (error) throw error

  const result = { delivered: 0, retried: 0, deadLetters: 0, skipped: 0 }
  for (const job of (data ?? []) as Job[]) {
    const { data: claimed } = await db
      .from('webhook_delivery_jobs')
      .update({ status: 'processing', last_attempt_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('status', 'queued')
      .select('id')
      .maybeSingle()
    if (!claimed) continue

    const outcome = await deliverJob(db, job)
    result[outcome]++
  }
  return result
}

async function deliverJob(
  db: SupabaseClient,
  job: Job,
): Promise<'delivered' | 'retried' | 'deadLetters' | 'skipped'> {
  const { data: endpoint, error } = await db
    .from('webhook_endpoints')
    .select('id, account_id, url, secret, is_active, integration_type')
    .eq('id', job.endpoint_id)
    .eq('account_id', job.account_id)
    .maybeSingle()
  if (error) throw error
  if (!endpoint || !endpoint.is_active) {
    await finish(db, job, 'skipped', 'El endpoint ya no está activo o fue eliminado.', null)
    return 'skipped'
  }

  const typedEndpoint = endpoint as Endpoint
  if (!(await isDeliverableUrl(typedEndpoint.url))) {
    await recordFailure(db, typedEndpoint)
    await finish(db, job, 'dead_letter', 'La URL no resuelve a un destino HTTPS público.', null)
    return 'deadLetters'
  }

  let secret: string
  try {
    secret = decrypt(typedEndpoint.secret)
  } catch {
    await recordFailure(db, typedEndpoint)
    await finish(db, job, 'dead_letter', 'No fue posible descifrar el secreto del endpoint.', null)
    return 'deadLetters'
  }

  const timestamp = Math.floor(Date.now() / 1000)
  try {
    const response = await fetch(typedEndpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-NexoOmni-Event': job.event_type,
        'X-NexoOmni-Webhook-Id': typedEndpoint.id,
        'X-NexoOmni-Signature': buildSignatureHeader(job.payload, secret, timestamp),
        'X-Wacrm-Event': job.event_type,
        'X-Wacrm-Webhook-Id': typedEndpoint.id,
        'X-Wacrm-Signature': buildSignatureHeader(job.payload, secret, timestamp),
      },
      body: job.payload,
      redirect: 'manual',
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`endpoint responded ${response.status}`)

    await db.from('webhook_endpoints')
      .update({ failure_count: 0, last_delivery_at: new Date().toISOString() })
      .eq('id', typedEndpoint.id)
      .eq('account_id', job.account_id)
    await finish(db, job, 'delivered', null, response.status)
    await logN8n(db, typedEndpoint, job, 'delivered', response.status, 'Evento recibido correctamente por n8n.')
    return 'delivered'
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message.slice(0, 500) : 'No se pudo entregar el evento.'
    const httpStatus = Number(detail.match(/endpoint responded (\d{3})/)?.[1]) || null
    await recordFailure(db, typedEndpoint)
    if (job.attempt_count + 1 >= MAX_ATTEMPTS) {
      await finish(db, job, 'dead_letter', detail, httpStatus)
      await logN8n(db, typedEndpoint, job, 'failed', httpStatus, detail)
      return 'deadLetters'
    }
    await db.from('webhook_delivery_jobs').update({
      status: 'queued',
      attempt_count: job.attempt_count + 1,
      next_attempt_at: new Date(Date.now() + retryDelayMs(job.attempt_count + 1)).toISOString(),
      last_error: detail,
      last_http_status: httpStatus,
    }).eq('id', job.id).eq('status', 'processing')
    return 'retried'
  }
}

async function finish(db: SupabaseClient, job: Job, status: 'delivered' | 'dead_letter' | 'skipped', error: string | null, httpStatus: number | null) {
  await db.from('webhook_delivery_jobs').update({
    status,
    attempt_count: job.attempt_count + 1,
    delivered_at: status === 'delivered' ? new Date().toISOString() : null,
    last_error: error,
    last_http_status: httpStatus,
  }).eq('id', job.id).eq('status', 'processing')
}

async function recordFailure(db: SupabaseClient, endpoint: Endpoint) {
  const { error } = await db.rpc('record_webhook_failure', {
    endpoint_id: endpoint.id,
    max_failures: MAX_CONSECUTIVE_FAILURES,
  })
  if (error) console.error('[webhooks] record_webhook_failure failed:', error)
}

async function logN8n(db: SupabaseClient, endpoint: Endpoint, job: Job, outcome: 'delivered' | 'failed', httpStatus: number | null, detail: string) {
  if (endpoint.integration_type !== 'n8n') return
  await recordN8nDelivery(db, {
    accountId: job.account_id,
    endpointId: endpoint.id,
    deliveryId: job.delivery_id,
    eventType: job.event_type,
    outcome,
    httpStatus,
    detail,
  })
}