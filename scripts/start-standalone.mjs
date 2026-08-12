import { spawn } from 'node:child_process';

// Nixpacks/Docker inject a random container HOSTNAME. Next's standalone
// server otherwise binds to it, while Easypanel probes the container over
// its network address. Bind explicitly to every interface instead.
const child = spawn(process.execPath, ['.next/standalone/server.js'], {
  stdio: 'inherit',
  env: { ...process.env, HOSTNAME: '0.0.0.0' },
});

// Automatic conversation analysis is intentionally a child of the main app
// process. This keeps the worker alive with the deployment and avoids a
// second `npm start` process or an Easypanel shell script that can be killed
// after it returns. It is inert until the administrator supplies the secret.
let workerTimer = null;
let initialWorkerTimer = null;
let workerRunning = false;
let flowsCronTimer = null;
let initialFlowsCronTimer = null;
let flowsCronRunning = false;
const canRunAnalysisWorker = Boolean(
  process.env.APP_URL && process.env.AI_ANALYSIS_WORKER_SECRET,
);
const runAnalysisWorker = () => {
  if (!canRunAnalysisWorker || workerRunning) return;
  workerRunning = true;
  const worker = spawn(process.execPath, ['scripts/run-ai-analysis-worker.mjs'], {
    stdio: 'inherit',
    env: process.env,
  });
  worker.on('error', (error) => console.error('[ai analysis worker] spawn failed:', error));
  worker.on('exit', () => { workerRunning = false; });
};

// Flow runs can wait for customer input. Sweep those that exceeded their
// per-flow fallback window so a stale run never blocks a future trigger.
const canRunFlowsCron = Boolean(
  process.env.APP_URL && process.env.AUTOMATION_CRON_SECRET,
);
const runFlowsCron = () => {
  if (!canRunFlowsCron || flowsCronRunning) return;
  flowsCronRunning = true;
  const cron = spawn(process.execPath, ['scripts/run-flows-cron.mjs'], {
    stdio: 'inherit',
    env: process.env,
  });
  cron.on('error', (error) => console.error('[flows cron] spawn failed:', error));
  cron.on('exit', () => { flowsCronRunning = false; });
};

if (canRunAnalysisWorker) {
  // Give Next enough time to accept the first local/public request, then
  // continue at the policy's one-minute cadence.
  initialWorkerTimer = setTimeout(runAnalysisWorker, 15_000);
  workerTimer = setInterval(runAnalysisWorker, 60_000);
} else {
  console.info('[ai analysis worker] disabled: APP_URL or AI_ANALYSIS_WORKER_SECRET is missing.');
}

if (canRunFlowsCron) {
  initialFlowsCronTimer = setTimeout(runFlowsCron, 30_000);
  flowsCronTimer = setInterval(runFlowsCron, 5 * 60_000);
} else {
  console.info('[flows cron] disabled: APP_URL or AUTOMATION_CRON_SECRET is missing.');
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (workerTimer) clearInterval(workerTimer);
    if (initialWorkerTimer) clearTimeout(initialWorkerTimer);
    if (flowsCronTimer) clearInterval(flowsCronTimer);
    if (initialFlowsCronTimer) clearTimeout(initialFlowsCronTimer);
    child.kill(signal);
  });
}

child.on('exit', (code) => process.exit(code ?? 0));
