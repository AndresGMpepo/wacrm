/**
 * Closes stale active Flow runs from the same app process that runs
 * NexoOmni. This avoids an additional Easypanel shell loop and makes
 * deployments/restarts deterministic.
 */
const appUrl = process.env.APP_URL?.replace(/\/$/, '');
const secret = process.env.AUTOMATION_CRON_SECRET;

if (!appUrl || !secret) {
  console.error('[flows cron] APP_URL or AUTOMATION_CRON_SECRET is missing.');
  process.exitCode = 1;
} else {
  try {
    const response = await fetch(`${appUrl}/api/flows/cron`, {
      headers: { 'x-cron-secret': secret },
      cache: 'no-store',
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 400)}`);
    }
    console.info(`[flows cron] ${body}`);
  } catch (error) {
    console.error('[flows cron] request failed:', error);
    process.exitCode = 1;
  }
}
