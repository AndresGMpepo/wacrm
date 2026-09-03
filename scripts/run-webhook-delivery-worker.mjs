const appUrl = process.env.APP_URL?.replace(/\/$/, '')
const secret = process.env.WEBHOOK_DELIVERY_WORKER_SECRET

if (!appUrl || !secret) {
  console.error('[webhook delivery worker] APP_URL or WEBHOOK_DELIVERY_WORKER_SECRET is missing.')
  process.exitCode = 1
} else {
  try {
    const response = await fetch(`${appUrl}/api/internal/webhook-delivery-worker`, {
      method: 'POST',
      headers: { 'x-webhook-delivery-worker-secret': secret },
      cache: 'no-store',
    })
    const body = await response.text()
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 400)}`)
    console.info(`[webhook delivery worker] ${body}`)
  } catch (error) {
    console.error('[webhook delivery worker] request failed:', error)
    process.exitCode = 1
  }
}