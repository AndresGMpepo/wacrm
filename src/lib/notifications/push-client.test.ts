import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDevicePushConfiguration, subscriptionKeyMatches } from './push-client';

afterEach(() => vi.unstubAllGlobals());

describe('device push configuration', () => {
  it('retrieves the public key at runtime and checks this exact device registration', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ publicKey: 'runtime-key', registered: false }));
    vi.stubGlobal('fetch', fetch);
    expect(await getDevicePushConfiguration('https://fcm.googleapis.com/device')).toEqual({
      publicKey: 'runtime-key', registered: false,
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/push/subscription?endpoint=https%3A%2F%2Ffcm.googleapis.com%2Fdevice', { cache: 'no-store' },
    );
  });

  it('reports missing server configuration despite granted browser permission', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ code: 'notConfigured' }, { status: 503 })));
    await expect(getDevicePushConfiguration()).rejects.toMatchObject({ code: 'notConfigured' });
  });

  it('rejects a success-shaped invalid response rather than claiming push is enabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true })));
    await expect(getDevicePushConfiguration()).rejects.toMatchObject({ code: 'requestFailed' });
  });

  it('recognizes a rotated VAPID key', () => {
    vi.stubGlobal('window', { atob: globalThis.atob });
    const subscription = { options: { applicationServerKey: Uint8Array.from([1, 2, 3]).buffer, userVisibleOnly: true } };
    expect(subscriptionKeyMatches(subscription, 'AQID')).toBe(true);
    expect(subscriptionKeyMatches(subscription, 'AQIE')).toBe(false);
  });
});
