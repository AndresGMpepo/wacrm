import { createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { countAssignedUnreadMessages } from './unread-messages';

function mockDatabase(pages: Response[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const page of pages) fetch.mockResolvedValueOnce(page);
  const db = createClient('https://supabase.example', 'test-key', {
    global: { fetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { db, fetch };
}

describe('countAssignedUnreadMessages', () => {
  it('counts messages rather than conversations or unread notification records', async () => {
    const { db, fetch } = mockDatabase([Response.json([{ unread_count: 2 }, { unread_count: 3 }])]);
    expect(await countAssignedUnreadMessages(db, 'account-id', 'agent-id')).toBe(5);
    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.searchParams.get('account_id')).toBe('eq.account-id');
    expect(url.searchParams.get('assigned_agent_id')).toBe('eq.agent-id');
    expect(url.searchParams.get('unread_count')).toBe('gt.0');
    expect(url.searchParams.get('select')).toBe('unread_count');
  });

  it('returns zero after all assigned messages have been read', async () => {
    const { db } = mockDatabase([Response.json([])]);
    expect(await countAssignedUnreadMessages(db, 'account-id', 'agent-id')).toBe(0);
  });

  it('paginates so a row limit does not silently truncate the count', async () => {
    const { db, fetch } = mockDatabase([
      Response.json(Array.from({ length: 500 }, () => ({ unread_count: 1 }))),
      Response.json([{ unread_count: 2 }]),
    ]);
    expect(await countAssignedUnreadMessages(db, 'account-id', 'agent-id')).toBe(502);
    expect(fetch).toHaveBeenCalledTimes(2);
    const url = new URL(String(fetch.mock.calls[1][0]));
    expect(url.searchParams.get('offset')).toBe('500');
  });

  it('propagates query errors rather than silently clearing the badge', async () => {
    const { db } = mockDatabase([Response.json({ message: 'Database unavailable' }, { status: 500 })]);
    await expect(countAssignedUnreadMessages(db, 'account-id', 'agent-id'))
      .rejects.toMatchObject({ message: 'Database unavailable' });
  });
});
