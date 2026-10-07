import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const script = readFileSync(join(process.cwd(), 'scripts', 'start-standalone.mjs'), 'utf8')
  .replace(/^import .+;\r?$/gm, '');

function launcher(flattened: boolean, configured: boolean) {
  const spawn = vi.fn().mockImplementation(() => ({ on: vi.fn(), kill: vi.fn() }));
  const timers: { callback: () => void; delay: number }[] = [];
  const logger = { info: vi.fn(), error: vi.fn() };
  runInNewContext(script, {
    spawn,
    existsSync: () => !flattened,
    process: {
      execPath: 'node',
      env: configured ? { APP_URL: 'https://nexoomni.example', AI_ANALYSIS_WORKER_SECRET: 'test-secret' } : {},
      on: vi.fn(), exit: vi.fn(),
    },
    setTimeout: (callback: () => void, delay: number) => { timers.push({ callback, delay }); },
    setInterval: vi.fn(), clearInterval: vi.fn(), clearTimeout: vi.fn(),
    console: logger,
  });
  return { spawn, timers, logger };
}

describe('push worker deployment launch', () => {
  it('starts Docker standalone output and the existing protected minute worker', () => {
    const { spawn, timers } = launcher(true, true);
    expect(spawn).toHaveBeenCalledWith('node', ['server.js'], expect.objectContaining({
      env: expect.objectContaining({ HOSTNAME: '0.0.0.0' }),
    }));
    timers.find((timer) => timer.delay === 15_000)?.callback();
    expect(spawn).toHaveBeenCalledWith('node', ['scripts/run-ai-analysis-worker.mjs'], expect.any(Object));
    const dockerfile = readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8');
    expect(dockerfile).toContain('/app/scripts ./scripts');
    expect(dockerfile).toContain('CMD ["node", "scripts/start-standalone.mjs"]');
  });

  it('preserves the Nixpacks standalone server path', () => {
    const { spawn } = launcher(false, true);
    expect(spawn.mock.calls[0][1]).toEqual(['.next/standalone/server.js']);
  });

  it('logs missing worker configuration and never starts a success-shaped idle worker', () => {
    const { spawn, timers, logger } = launcher(true, false);
    expect(timers).toEqual([]);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      '[ai analysis worker] disabled: APP_URL or AI_ANALYSIS_WORKER_SECRET is missing.',
    );
  });
});
