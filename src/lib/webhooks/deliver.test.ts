import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (s: string) => s,
  encrypt: (s: string) => s,
}));

// Control the SSRF guard per-test.
vi.mock('@/lib/webhooks/ssrf', () => ({
  isDeliverableUrl: vi.fn(async () => true),
}));

import { retryDelayMs } from './delivery-worker';
import { dispatchWebhookEvent } from './deliver';
import { isDeliverableUrl } from './ssrf';

interface Row {
  id: string;
  url: string;
  secret: string;
}
interface Calls {
  queued: Record<string, unknown>[];
}

function makeDb(rows: Row[], calls: Calls) {
  const from = (table: string) => {
    let payload: Record<string, unknown>[] = [];
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      contains: () => b,
      insert: (rowsToInsert: Record<string, unknown>[]) => {
        payload = rowsToInsert;
        return b;
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (table === 'webhook_delivery_jobs') {
          calls.queued.push(...payload);
          return resolve({ error: null });
        }
        return resolve({ data: rows, error: null });
      },
    };
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

const emptyCalls = (): Calls => ({ queued: [] });

beforeEach(() => {
  vi.mocked(isDeliverableUrl).mockResolvedValue(true);
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe('dispatchWebhookEvent', () => {
  it('queues a stable, deduplicable delivery instead of sending inside the caller', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const calls = emptyCalls();

    await dispatchWebhookEvent(
      makeDb([{ id: 'a', url: 'https://a.test/hook', secret: 's1' }], calls),
      'acct-1',
      'message.received',
      { x: 1 }
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls.queued).toHaveLength(1);
    expect(calls.queued[0]).toMatchObject({ account_id: 'acct-1', endpoint_id: 'a', event_type: 'message.received' });
    expect(calls.queued[0].delivery_id).toMatch(/[0-9a-f-]{36}/);
    expect(JSON.parse(calls.queued[0].payload as string)).toMatchObject({
      id: calls.queued[0].delivery_id,
      event: 'message.received',
      account_id: 'acct-1',
      data: { x: 1 },
    });
  });

  it('creates an independent job for each subscribed endpoint', async () => {
    const calls = emptyCalls();

    await dispatchWebhookEvent(
      makeDb([
        { id: 'a', url: 'https://a.test/hook', secret: 's1' },
        { id: 'b', url: 'https://b.test/hook', secret: 's2' },
      ], calls),
      'acct-1',
      'message.received',
      {}
    );

    expect(calls.queued).toHaveLength(2);
    expect(calls.queued[0].delivery_id).not.toBe(calls.queued[1].delivery_id);
  });

  it('does not resolve or fetch the endpoint until the delivery worker claims it', async () => {
    vi.mocked(isDeliverableUrl).mockResolvedValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const calls = emptyCalls();

    await dispatchWebhookEvent(
      makeDb([{ id: 'c', url: 'https://127.0.0.1/hook', secret: 's3' }], calls),
      'acct-1',
      'message.received',
      {}
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(isDeliverableUrl).not.toHaveBeenCalled();
    expect(calls.queued).toHaveLength(1);
  });

  it('does nothing when no endpoints are subscribed', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const calls = emptyCalls();
    await dispatchWebhookEvent(makeDb([], calls), 'acct-1', 'message.received', {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls.queued).toHaveLength(0);
  });
});

describe('retryDelayMs', () => {
  it('uses bounded exponential backoff between attempts', () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(2)).toBe(120_000);
    expect(retryDelayMs(20)).toBe(15 * 60_000);
  });
});
