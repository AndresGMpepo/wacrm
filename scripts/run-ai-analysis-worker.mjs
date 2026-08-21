// Run from an Easypanel cron job every minute. It only calls the protected
// internal route; all queue claiming and AI work stays inside the app.
const baseUrl = process.env.APP_URL?.replace(/\/$/, '')
const secret = process.env.AI_ANALYSIS_WORKER_SECRET

if (!baseUrl || !secret) {
  console.error('APP_URL and AI_ANALYSIS_WORKER_SECRET are required.')
  process.exit(1)
}

const headers = { 'x-ai-worker-secret': secret, 'x-report-worker-secret': secret }
const [analysisResponse, reportResponse, transcriptionResponse] = await Promise.all([
  fetch(`${baseUrl}/api/internal/ai-analysis-worker`, { method: 'POST', headers }),
  fetch(`${baseUrl}/api/internal/report-schedule-worker`, { method: 'POST', headers }),
  fetch(`${baseUrl}/api/internal/yeastar-transcription-retry`, { method: 'POST', headers }),
])

if (!analysisResponse.ok) {
  console.error(`AI worker request failed: ${analysisResponse.status} ${await analysisResponse.text()}`)
  process.exit(1)
}
if (!transcriptionResponse.ok) {
  console.error(`Yeastar transcription retry request failed: ${transcriptionResponse.status} ${await transcriptionResponse.text()}`)
} else {
  console.log(JSON.stringify({ yeastarTranscriptions: await transcriptionResponse.json() }))
}
const reports = reportResponse.ok
  ? await reportResponse.json()
  : { error: `Report worker request failed: ${reportResponse.status} ${await reportResponse.text()}` }
if ('error' in reports) console.error(`[report schedule worker] ${reports.error}`)
console.log(JSON.stringify({ analysis: await analysisResponse.json(), reports }))
