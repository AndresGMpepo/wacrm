import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const script = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8');

interface WorkerEvent {
  data?: { json: () => object } | { type: string; count: number };
  request?: Request;
  waitUntil: (promise: Promise<unknown>) => void;
  respondWith: (promise: Promise<Response>) => void;
}

function createWorker(userAgent: string, badging = true) {
  const handlers = new Map<string, (event: WorkerEvent) => void>();
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const getNotifications = vi.fn().mockResolvedValue([]);
  const setAppBadge = vi.fn().mockResolvedValue(undefined);
  const clearAppBadge = vi.fn().mockResolvedValue(undefined);
  const matchAll = vi.fn().mockResolvedValue([{
    url: 'https://nexoomni.example/inbox', visibilityState: 'visible',
  }]);
  const logger = { error: vi.fn() };
  runInNewContext(script, {
    self: {
      navigator: { userAgent, ...(badging ? { setAppBadge, clearAppBadge } : {}) },
      location: { origin: 'https://nexoomni.example' },
      registration: { showNotification, getNotifications },
      clients: { matchAll },
      addEventListener: (name: string, handler: (event: WorkerEvent) => void) => {
        handlers.set(name, handler);
      },
    },
    URL, Response, console: logger,
  });
  const dispatch = async (name: string, data: WorkerEvent['data']) => {
    const pending: Promise<unknown>[] = [];
    handlers.get(name)?.({
      data,
      waitUntil: (promise) => { pending.push(promise); },
      respondWith: vi.fn(),
    });
    await Promise.all(pending);
  };
  const push = (unreadCount: number) => dispatch('push', {
    json: () => ({
      title: 'Nexoomni', body: 'New assigned message', tag: 'nexoomni-notification-id',
      url: '/inbox?c=conversation-id', unreadCount,
    }),
  });
  return { handlers, dispatch, push, showNotification, getNotifications, setAppBadge, clearAppBadge, matchAll, logger };
}

describe('service worker message notifications', () => {
  it('shows a persistent audible desktop notification even with a visible app window', async () => {
    const worker = createWorker('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    await worker.push(2);
    expect(worker.showNotification).toHaveBeenCalledWith('Nexoomni', expect.objectContaining({
      silent: false, requireInteraction: true, renotify: false,
      vibrate: [200, 100, 200], tag: 'nexoomni-notification-id',
      data: { url: '/inbox?c=conversation-id' },
    }));
    expect(worker.matchAll).not.toHaveBeenCalled();
    expect(worker.setAppBadge).not.toHaveBeenCalled();
    expect(worker.clearAppBadge).not.toHaveBeenCalled();
  });

  it.each([
    'Mozilla/5.0 (Linux; Android 14) Mobile',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Mobile/15E148',
  ])('updates the mobile badge from authoritative unread counts: %s', async (agent) => {
    const worker = createWorker(agent);
    await worker.push(1);
    await worker.push(2);
    expect(worker.setAppBadge.mock.calls).toEqual([[1], [2]]);
    expect(worker.showNotification).toHaveBeenCalledTimes(2);
    expect(worker.showNotification).toHaveBeenLastCalledWith('Nexoomni', expect.objectContaining({
      silent: false, requireInteraction: false, vibrate: [200, 100, 200],
    }));
    await worker.dispatch('message', { type: 'NEXOOMNI_UNREAD_MESSAGES', count: 0 });
    expect(worker.clearAppBadge).toHaveBeenCalledOnce();
  });

  it('does not badge desktop devices when a client sends a badge message', async () => {
    const worker = createWorker('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)');
    await worker.dispatch('message', { type: 'NEXOOMNI_UNREAD_MESSAGES', count: 3 });
    expect(worker.setAppBadge).not.toHaveBeenCalled();
  });

  it('does not repeat a desktop Realtime alert still displayed when its push arrives', async () => {
    const worker = createWorker('Windows');
    worker.getNotifications.mockResolvedValueOnce([{ tag: 'nexoomni-notification-id' }]);
    await worker.push(2);
    expect(worker.getNotifications).toHaveBeenCalledWith({ tag: 'nexoomni-notification-id' });
    expect(worker.showNotification).not.toHaveBeenCalled();
  });

  it('still synchronizes the mobile badge when the notification is already displayed', async () => {
    const worker = createWorker('Android Mobile');
    worker.getNotifications.mockResolvedValueOnce([{ tag: 'nexoomni-notification-id' }]);
    await worker.push(2);
    expect(worker.showNotification).not.toHaveBeenCalled();
    expect(worker.setAppBadge).toHaveBeenCalledWith(2);
  });

  it('still shows mobile alerts without Badging API support', async () => {
    const worker = createWorker('Android Mobile', false);
    await worker.push(3);
    expect(worker.showNotification).toHaveBeenCalledOnce();
    expect(worker.logger.error).not.toHaveBeenCalled();
  });

  it('logs badge failures without preventing the system notification', async () => {
    const worker = createWorker('Android Mobile');
    worker.setAppBadge.mockRejectedValueOnce(new Error('Badging denied'));
    await worker.push(3);
    expect(worker.showNotification).toHaveBeenCalledOnce();
    expect(worker.logger.error).toHaveBeenCalled();
  });

  it.each([-1, 1.5, NaN])('rejects an invalid unread count: %s', async (count) => {
    const worker = createWorker('Android Mobile');
    await worker.dispatch('message', { type: 'NEXOOMNI_UNREAD_MESSAGES', count });
    expect(worker.setAppBadge).not.toHaveBeenCalled();
    expect(worker.clearAppBadge).not.toHaveBeenCalled();
  });

  it('never intercepts API requests, including unread synchronization', () => {
    const worker = createWorker('Android Mobile');
    const respondWith = vi.fn();
    worker.handlers.get('fetch')?.({
      request: new Request('https://nexoomni.example/api/push/subscription'),
      respondWith, waitUntil: vi.fn(),
    });
    expect(respondWith).not.toHaveBeenCalled();
  });
});
