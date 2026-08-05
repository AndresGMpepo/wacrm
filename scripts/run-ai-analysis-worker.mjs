// Run from an Easypanel cron job every minute. It only calls the protected
// internal route; all queue claiming and AI work stays inside the app.
const baseUrl = process.env.APP_URL?.replace(/\/$/, '')
const secret = process.env.AI_ANALYSIS_WORKER_SECRET

if (!baseUrl || !secret) {
  console.error('APP_URL and AI_ANALYSIS_WORKER_SECRET are required.')
  process.exit(1)
}

const response = await fetch(`${baseUrl}/api/internal/ai-analysis-worker`, {
  method: 'POST',
  headers: { 'x-ai-worker-secret': secret },
})
if (!response.ok) {
  console.error(`Worker request failed: ${response.status} ${await response.text()}`)
  process.exit(1)
}
console.log(await response.text())
