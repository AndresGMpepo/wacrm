import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/zernio/server', () => ({
  sendZernioTemplateMessage: vi.fn(),
  sendZernioTemplateToConversation: vi.fn(),
}));

import { sendZernioTemplateMessage, sendZernioTemplateToConversation } from '@/lib/zernio/server';
import { sendZernioTemplateToContact } from './send-template-to-contact';

type Row = Record<string, unknown>;

/** Minimal chainable Supabase stub. `selects[table]` is a queue of results
 *  for successive awaited selects on that table; inserts are recorded. */
function makeDb(opts: {
  existingConversation?: Row | null;
  insertConversationError?: { code: string } | null;
  racedConversation?: Row | null;
}) {
  const inserts: { table: string; row: Row }[] = [];
  const updates: { table: string; patch: Row }[] = [];
  let conversationSelects = 0;

  const from = (table: string) => {
    let mode: 'select' | 'insert' | 'update' = 'select';
    let payload: Row = {};
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    Object.assign(builder, {
      select: chain, eq: chain, in: chain, not: chain, order: chain, is: chain,
      insert: (row: Row) => { mode = 'insert'; payload = row; inserts.push({ table, row }); return builder; },
      update: (patch: Row) => { mode = 'update'; payload = patch; updates.push({ table, patch }); return builder; },
      limit: () => {
        if (table === 'conversations') {
          conversationSelects++;
          const row = conversationSelects === 1 ? opts.existingConversation : opts.racedConversation;
          return Promise.resolve({ data: row ? [row] : [], error: null });
        }
        return Promise.resolve({ data: [], error: null });
      },
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      single: () => {
        if (table === 'conversations' && mode === 'insert') {
          if (opts.insertConversationError) return Promise.resolve({ data: null, error: opts.insertConversationError });
          return Promise.resolve({ data: { id: 'conv-new' }, error: null });
        }
        return Promise.resolve({ data: payload, error: null });
      },
      then: (resolve: (v: { data: null; error: null }) => void) => resolve({ data: null, error: null }),
    });
    return builder;
  };

  return { db: { from } as unknown as SupabaseClient, inserts, updates };
}

const base = {
  accountId: 'acct',
  contactId: 'contact-1',
  phone: '+52 55 1234 5678',
  ownerUserId: 'owner',
  templateName: 'confirmacion_cita_24h',
  templateLanguage: 'es_MX',
  bodyParams: ['Ana', 'Terapia', 'viernes 3', '10:00', 'Balbuena'],
  connectors: [{ id: 'conn-1', zernio_account_id: 'zacc-1' }],
};

describe('sendZernioTemplateToContact', () => {
  beforeEach(() => {
    vi.mocked(sendZernioTemplateMessage).mockReset();
    vi.mocked(sendZernioTemplateToConversation).mockReset();
  });

  it('sends into the existing Zernio thread and logs it as a bot message', async () => {
    vi.mocked(sendZernioTemplateToConversation).mockResolvedValue('zmsg-1');
    const { db, inserts } = makeDb({ existingConversation: { id: 'conv-1', connector_id: 'conn-1', external_session_id: 'zconv-1' } });

    const result = await sendZernioTemplateToContact(db, base);

    expect(result).toEqual({ conversationId: 'conv-1', messageId: 'zmsg-1' });
    expect(sendZernioTemplateToConversation).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'zconv-1', zernioAccountId: 'zacc-1', bodyParams: base.bodyParams,
    }));
    expect(sendZernioTemplateMessage).not.toHaveBeenCalled();
    const message = inserts.find((i) => i.table === 'messages')?.row;
    // 'bot' with no sender_id: must not count as "a human already replied".
    expect(message).toMatchObject({ conversation_id: 'conv-1', sender_type: 'bot', platform_message_id: 'zmsg-1' });
    expect(message).not.toHaveProperty('sender_id');
  });

  it('opens a new Zernio conversation by phone when the contact has none', async () => {
    vi.mocked(sendZernioTemplateMessage).mockResolvedValue({ messageId: 'zmsg-2', conversationId: 'zconv-2' });
    const { db, inserts } = makeDb({ existingConversation: null });

    const result = await sendZernioTemplateToContact(db, base);

    expect(result.conversationId).toBe('conv-new');
    expect(sendZernioTemplateMessage).toHaveBeenCalledWith(expect.objectContaining({
      // Same digits-only form the Inbox's own Zernio send already uses.
      zernioAccountId: 'zacc-1', phone: '525512345678', templateParams: base.bodyParams,
    }));
    expect(inserts.find((i) => i.table === 'conversations')?.row).toMatchObject({
      channel_type: 'zernio_whatsapp', connector_id: 'conn-1', external_session_id: 'zconv-2',
    });
  });

  it("reuses the webhook's row when its echo created the conversation first", async () => {
    vi.mocked(sendZernioTemplateMessage).mockResolvedValue({ messageId: 'zmsg-3', conversationId: 'zconv-3' });
    const { db } = makeDb({
      existingConversation: null,
      insertConversationError: { code: '23505' },
      racedConversation: { id: 'conv-from-webhook' },
    });

    const result = await sendZernioTemplateToContact(db, base);

    expect(result.conversationId).toBe('conv-from-webhook');
  });

  it('rejects an invalid phone without calling Zernio', async () => {
    const { db } = makeDb({});
    await expect(sendZernioTemplateToContact(db, { ...base, phone: 'zernio:zernio_whatsapp:abc' })).rejects.toThrow();
    expect(sendZernioTemplateMessage).not.toHaveBeenCalled();
    expect(sendZernioTemplateToConversation).not.toHaveBeenCalled();
  });
});
