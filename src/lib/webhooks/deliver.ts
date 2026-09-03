// ============================================================
// Outbound webhook enqueueing.
//
// `dispatchWebhookEvent` finds the account's active endpoints
// subscribed to an event and persists one delivery job per endpoint.
// The protected delivery worker signs and POSTs those jobs later, so a
// short-lived `after()` callback never decides whether the event is lost.
//
// Delivery semantics (documented in docs/public-api.md):
//   - At-least-once per endpoint: retries carry a stable delivery id,
//     which receivers use to deduplicate.
//   - The queue worker retries transient failures a bounded number of
//     times, then preserves the job as a dead letter for investigation.
// ============================================================

import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { WebhookEvent } from '@/lib/webhooks/events';

/** Per-endpoint HTTP timeout, used by the delivery worker. */
export const DELIVERY_TIMEOUT_MS = 5000;

/** Auto-disable an endpoint after this many consecutive failures. */
export const MAX_CONSECUTIVE_FAILURES = 15;

interface EndpointRow {
  id: string;
  account_id: string;
}

/**
 * Queue `event` (+ `data`) for every active endpoint of `accountId`.
 * Never throws: callers invoke it after acknowledging provider webhooks.
 */
export async function dispatchWebhookEvent(
  db: SupabaseClient,
  accountId: string,
  event: WebhookEvent,
  data: unknown
): Promise<void> {
  try {
    const { data: rows, error } = await db
      .from('webhook_endpoints')
      .select('id, account_id')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .contains('events', [event]);

    if (error || !rows || rows.length === 0) return;

    const occurredAt = new Date().toISOString()
    const jobs = (rows as EndpointRow[]).map((row) => {
      const deliveryId = randomUUID()
      return {
        account_id: accountId,
        endpoint_id: row.id,
        delivery_id: deliveryId,
        event_type: event,
        payload: JSON.stringify({ id: deliveryId, event, occurred_at: occurredAt, account_id: accountId, data }),
      }
    })
    const { error: queueError } = await db.from('webhook_delivery_jobs').insert(jobs)
    if (queueError) console.error('[webhooks] could not queue deliveries:', queueError)
  } catch (err) {
    // Never let a delivery problem bubble into the webhook response.
    console.error('[webhooks] dispatch failed:', err);
  }
}

