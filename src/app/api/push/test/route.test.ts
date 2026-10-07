import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(), send: vi.fn(), configuration: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: () => Response.json({ error: 'Forbidden' }, { status: 403 }),
}));
vi.mock('@/lib/notifications/web-push', () => ({
  sendDeviceTestPush: mocks.send,
  vapidConfiguration: mocks.configuration,
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: vi.fn(),
  RATE_LIMITS: { broadcast: { limit: 5, windowMs: 60_000 } },
}));

import { POST } from './route';
import { GET } from '../subscription/route';

const endpoint = 'https://fcm.googleapis.com/fcm/send/device-id';
const subscription = { id: 'device-id', endpoint, p256dh: 'key', auth: 'auth', locale: 'es' };

function scopedDatabase(rows: object[] = [subscription]) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(rows));
  const db = createClient('https://supabase.example', 'test-key', {
    global: { fetch }, auth: { persistSession: false, autoRefreshToken: false },
  });
  mocks.requireRole.mockResolvedValue({ supabase: db, accountId: 'account-id', userId: 'agent-id' });
  return fetch;
}

function request(value = endpoint) {
  return new Request('https://nexoomni.example/api/push/test', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: value }),
  });
}

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.send.mockReset().mockResolvedValue(undefined);
  mocks.configuration.mockReset().mockReturnValue({
    publicKey: 'runtime-public-key', privateKey: 'never-exposed', subject: 'mailto:test@example.com',
  });
});
afterEach(() => vi.restoreAllMocks());

describe('device push test route', () => {
  it('only sends to the authenticated agent and account subscription', async () => {
    const fetch = scopedDatabase();
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true });
    expect(mocks.requireRole).toHaveBeenCalledWith('agent');
    expect(mocks.send).toHaveBeenCalledWith(subscription);
    const query = new URL(String(fetch.mock.calls[0][0]));
    expect(query.searchParams.get('account_id')).toBe('eq.account-id');
    expect(query.searchParams.get('user_id')).toBe('eq.agent-id');
    expect(query.searchParams.get('endpoint')).toBe(`eq.${endpoint}`);
  });

  it('does not send to a browser subscription not registered to this user', async () => {
    scopedDatabase([]);
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: 'subscriptionMissing' });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('rejects an arbitrary external endpoint before querying or sending', async () => {
    const fetch = scopedDatabase();
    expect((await POST(request('https://attacker.example/push'))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('surfaces a provider rejection instead of reporting a successful notification', async () => {
    scopedDatabase();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.send.mockRejectedValueOnce(new Error('Private provider details'));
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: 'pushTestFailed' });
  });

  it('rejects unauthorized requests before accessing subscriptions', async () => {
    const fetch = scopedDatabase();
    mocks.requireRole.mockRejectedValueOnce(new Error('Forbidden'));
    expect((await POST(request())).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('runtime configuration and registration status', () => {
  it('returns only the public key and verified device registration, never private credentials', async () => {
    scopedDatabase();
    const response = await GET(new Request(`https://nexoomni.example/api/push/subscription?endpoint=${encodeURIComponent(endpoint)}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ publicKey: 'runtime-public-key', registered: true });
  });

  it('does not treat granted browser permission as a saved subscription', async () => {
    scopedDatabase([]);
    const response = await GET(new Request(`https://nexoomni.example/api/push/subscription?endpoint=${encodeURIComponent(endpoint)}`));
    expect(await response.json()).toEqual({ publicKey: 'runtime-public-key', registered: false });
  });

  it('explicitly reports missing VAPID configuration', async () => {
    scopedDatabase();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.configuration.mockImplementationOnce(() => { throw new Error('Missing private key'); });
    const response = await GET(new Request('https://nexoomni.example/api/push/subscription'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: 'notConfigured' });
  });
});
