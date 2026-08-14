import type { SupabaseClient } from '@supabase/supabase-js'

type N8nDeliveryReceipt = {
  accountId: string
  endpointId: string
  deliveryId?: string | null
  eventType: string
  outcome: 'delivered' | 'failed' | 'test'
  httpStatus?: number | null
  detail: string
}

/**
 * Store delivery metadata without ever copying a customer message payload.
 * Delivery must remain best-effort, therefore logging failures are only sent
 * to server logs and never change an inbound WhatsApp/Live Chat response.
 */
export async function recordN8nDelivery(
  db: SupabaseClient,
  receipt: N8nDeliveryReceipt,
): Promise<void> {
  const { error } = await db.from('n8n_delivery_receipts').insert({
    account_id: receipt.accountId,
    endpoint_id: receipt.endpointId,
    delivery_id: receipt.deliveryId ?? null,
    event_type: receipt.eventType,
    outcome: receipt.outcome,
    http_status: receipt.httpStatus ?? null,
    detail: receipt.detail.slice(0, 500),
  })

  if (error) {
    console.error('[n8n delivery log] insert failed:', error)
  }
}
