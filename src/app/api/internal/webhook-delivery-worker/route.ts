import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { processWebhookDeliveryJobs } from '@/lib/webhooks/delivery-worker'

export const maxDuration = 60

export async function POST(request: Request) {
  const expected = process.env.WEBHOOK_DELIVERY_WORKER_SECRET
  const supplied = request.headers.get('x-webhook-delivery-worker-secret') ?? ''
  if (!expected || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    return NextResponse.json(await processWebhookDeliveryJobs(supabaseAdmin()))
  } catch (error) {
    console.error('[webhook delivery worker] failed:', error)
    return NextResponse.json({ error: 'Could not process webhook deliveries.' }, { status: 500 })
  }
}