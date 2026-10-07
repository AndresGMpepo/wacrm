import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { processWebPushOutbox, sendDeviceTestPush } from './web-push';

vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }) },
}));

afterEach(() => vi.unstubAllEnvs());

function deliveryDatabase(unreadQueryFails = false) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const table = url.pathname.split('/').pop();
    const method = init?.method ?? 'GET';
    if (table === 'web_push_outbox') {
      if (method === 'PATCH') {
        return url.searchParams.get('select') === 'id'
          ? Response.json([{ id: 'outbox-id' }])
          : new Response(null, { status: 204 });
      }
      return Response.json([{
        id: 'outbox-id', notification_id: 'notification-id', account_id: 'account-id',
        user_id: 'agent-id', conversation_id: 'conversation-id', attempts: 0,
      }]);
    }
    if (table === 'notifications') {
      return Response.json([{ id: 'notification-id', conversation_id: 'conversation-id' }]);
    }
    if (table === 'web_push_subscriptions') {
      return Response.json([{
        id: 'subscription-id', endpoint: 'https://fcm.googleapis.com/fcm/send/test',
        p256dh: 'test-key', auth: 'test-auth', locale: 'es',
      }]);
    }
    if (table === 'profiles') {
      return Response.json([{ account_id: 'account-id', account_role: 'agent' }]);
    }
    if (table === 'conversations') {
      if (url.searchParams.get('select') === 'unread_count') {
        return unreadQueryFails
          ? Response.json({ message: 'Unavailable' }, { status: 500 })
          : Response.json([{ unread_count: 2 }, { unread_count: 3 }]);
      }
      return Response.json([{ assigned_agent_id: 'agent-id' }]);
    }
    throw new Error(`Unexpected delivery query: ${url}`);
  });
  const db = createClient('https://supabase.example', 'test-service-key', {
    global: { fetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { db, fetch };
}

describe('background Web Push delivery', () => {
  it('sends a localized device test directly without a queued message or badge mutation', async () => {
    vi.stubEnv('NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY', 'runtime-public-key');
    vi.stubEnv('WEB_PUSH_VAPID_PRIVATE_KEY', 'runtime-private-key');
    vi.stubEnv('WEB_PUSH_VAPID_SUBJECT', 'mailto:test@example.com');
    await sendDeviceTestPush({
      id: 'device-id', endpoint: 'https://fcm.googleapis.com/device',
      p256dh: 'key', auth: 'auth', locale: 'es',
    });
    const [subscription, payload, options] = vi.mocked(webpush.sendNotification).mock.calls[0];
    expect(subscription.endpoint).toBe('https://fcm.googleapis.com/device');
    const parsed = JSON.parse(String(payload));
    expect(parsed.body).toContain('prueba');
    expect(parsed).not.toHaveProperty('unreadCount');
    expect(options).toMatchObject({
      urgency: 'high',
      vapidDetails: {
        publicKey: 'runtime-public-key', privateKey: 'runtime-private-key', subject: 'mailto:test@example.com',
      },
    });
  });

  it('sends high-urgency push with a server-computed unread count without any app window', async () => {
    vi.stubEnv('NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY', 'test-public-key');
    vi.stubEnv('WEB_PUSH_VAPID_PRIVATE_KEY', 'test-private-key');
    vi.stubEnv('WEB_PUSH_VAPID_SUBJECT', 'mailto:test@example.com');
    const { db } = deliveryDatabase();
    expect(await processWebPushOutbox(db)).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(webpush.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://fcm.googleapis.com/fcm/send/test' }),
      expect.any(String),
      { TTL: 300, timeout: 8_000, urgency: 'high' },
    );
    const payload = JSON.parse(vi.mocked(webpush.sendNotification).mock.calls[0][1] as string);
    expect(payload).toMatchObject({
      unreadCount: 5,
      tag: 'nexoomni-notification-id',
      url: '/inbox?c=conversation-id',
    });
    expect(payload).not.toHaveProperty('message');
  });

  it('retries when unread lookup fails rather than publishing an incorrect zero', async () => {
    vi.stubEnv('NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY', 'test-public-key');
    vi.stubEnv('WEB_PUSH_VAPID_PRIVATE_KEY', 'test-private-key');
    vi.stubEnv('WEB_PUSH_VAPID_SUBJECT', 'mailto:test@example.com');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { db, fetch } = deliveryDatabase(true);
      expect(await processWebPushOutbox(db)).toEqual({ sent: 0, skipped: 0, failed: 1 });
      expect(webpush.sendNotification).not.toHaveBeenCalled();
      const retry = fetch.mock.calls.find(([, init]) => {
        return typeof init?.body === 'string' && init.body.includes('Could not count unread messages.');
      });
      expect(retry).toBeDefined();
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
