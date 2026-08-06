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

if (canRunAnalysisWorker) {
  // Give Next enough time to accept the first local/public request, then
  // continue at the policy's one-minute cadence.
  initialWorkerTimer = setTimeout(runAnalysisWorker, 15_000);
  workerTimer = setInterval(runAnalysisWorker, 60_000);
} else {
  console.info('[ai analysis worker] disabled: APP_URL or AI_ANALYSIS_WORKER_SECRET is missing.');
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (workerTimer) clearInterval(workerTimer);
    if (initialWorkerTimer) clearTimeout(initialWorkerTimer);
    child.kill(signal);
  });
}

child.on('exit', (code) => process.exit(code ?? 0));
