/**
 * Purges messages older than the platform operator's configured
 * retention window (src/app/api/internal/message-retention). Intended to
 * run once a day via the host's own cron/scheduler — no-op (and cheap)
 * when no retention window is configured.
 */
const appUrl = process.env.APP_URL?.replace(/\/$/, '')
const secret = process.env.MESSAGE_RETENTION_CRON_SECRET

if (!appUrl || !secret) {
  console.error('[message retention] APP_URL or MESSAGE_RETENTION_CRON_SECRET is missing.')
  process.exitCode = 1
} else {
  try {
    const response = await fetch(`${appUrl}/api/internal/message-retention`, {
      method: 'POST',
      headers: { 'x-retention-cron-secret': secret },
      cache: 'no-store',
    })
    const body = await response.text()
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 400)}`)
    console.info(`[message retention] ${body}`)
  } catch (error) {
    console.error('[message retention] request failed:', error)
    process.exitCode = 1
  }
}
