import { spawn } from 'node:child_process';

// Nixpacks/Docker inject a random container HOSTNAME. Next's standalone
// server otherwise binds to it, while Easypanel probes the container over
// its network address. Bind explicitly to every interface instead.
const child = spawn(process.execPath, ['.next/standalone/server.js'], {
  stdio: 'inherit',
  env: { ...process.env, HOSTNAME: '0.0.0.0' },
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code) => process.exit(code ?? 0));
