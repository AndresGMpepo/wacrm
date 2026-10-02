import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveAgendaProWhatsApp } from './open-whatsapp';
import { SendMessageError } from '@/lib/whatsapp/send-message';

// ------------------------------------------------------------
// Chainable Supabase stub, scripted per table — mirrors the one in
// resolve-conversation.test.ts, extended for the two extra queries this
// module makes: `accounts.owner_user_id` (resolveAuditUserId's
// no-whatsapp-config fallback) and the zernio_whatsapp conversation
// lookup (`.not('external_session_id', 'is', null)` chained into
// `.order().limit()`, unlike dedupe's terminal `.not(...)` call).
// ------------------------------------------------------------
type ContactRow = { id: string; phone: string; name?: string | null };

interface Script {
  nativeConfig?: { user_id: string } | null; // whatsapp_config.maybeSingle (resolveAuditUserId)
  accountOwner?: string | null; // accounts.owner_user_id.maybeSingle
  contactCandidates?: ContactRow[]; // contacts .like
  insertedContactId?: string;
  insertContactError?: { code?: string } | null;
  /** zernio_whatsapp conversation lookup (`.not(...).order().limit(1)`). */
  existingZernioConversation?: { id: string } | null;
}

function makeDb(script: Script): SupabaseClient {
  let table = '';
  let mode: 'select' | 'insert' = 'select';

  const builder: Record<string, unknown> = {
    select: () => builder,
    insert: () => {
      mode = 'insert';
      return builder;
    },
    update: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => {
      if (table === 'conversations') {
        const row = script.existingZernioConversation ?? null;
        return Promise.resolve({ data: row ? [row] : [], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    },
    like: () => Promise.resolve({ data: script.contactCandidates ?? [], error: null }),
    // Chainable here (conversations lookup chains .order().limit() after
    // it) — unlike dedupe's terminal alternate-phones `.not(...)` call,
    // which this stub never reaches since contactCandidates already
    // short-circuits findExistingContact via the primary-phone match.
    not: () => (table === 'conversations' ? builder : Promise.resolve({ data: [], error: null })),
    maybeSingle: () => {
      if (table === 'whatsapp_config') return Promise.resolve({ data: script.nativeConfig ?? null, error: null });
      if (table === 'accounts')
        return Promise.resolve({
          data: script.accountOwner ? { owner_user_id: script.accountOwner } : null,
          error: null,
        });
      return Promise.resolve({ data: null, error: null });
    },
    single: () => {
      if (table === 'contacts' && mode === 'insert') {
        if (script.insertContactError) return Promise.resolve({ data: null, error: script.insertContactError });
        return Promise.resolve({ data: { id: script.insertedContactId }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    then: (resolve: (v: { data: null; error: null }) => void) => resolve({ data: null, error: null }),
  };

  return {
    from: (t: string) => {
      table = t;
      mode = 'select';
      return builder;
    },
  } as unknown as SupabaseClient;
}

const ZERNIO_CONNECTORS = [{ id: 'conn-1', displayName: 'Clínica WhatsApp' }];

describe('resolveAgendaProWhatsApp', () => {
  it('rejects an invalid phone before any DB call', async () => {
    const db = {
      from() {
        throw new Error('should not query');
      },
    } as unknown as SupabaseClient;
    await expect(
      resolveAgendaProWhatsApp(db, 'acct', 'not-a-phone', null, true, []),
    ).rejects.toBeInstanceOf(SendMessageError);
  });

  it('delegates to the native WhatsApp conversation resolver when the account has whatsapp_config', async () => {
    const db = makeDb({
      nativeConfig: { user_id: 'owner-1' },
      contactCandidates: [{ id: 'c1', phone: '14155550123' }],
      existingZernioConversation: { id: 'cv1' },
    });
    const result = await resolveAgendaProWhatsApp(db, 'acct', '+14155550123', null, true, []);
    expect(result).toEqual({ kind: 'conversation', conversationId: 'cv1' });
  });

  it('fails with whatsapp_not_configured when there is neither a native config nor a Zernio WhatsApp connector', async () => {
    const db = makeDb({});
    await expect(
      resolveAgendaProWhatsApp(db, 'acct', '+14155550123', null, false, []),
    ).rejects.toMatchObject({ code: 'whatsapp_not_configured', status: 400 });
  });

  it('returns the existing Zernio conversation when one already has a real external_session_id', async () => {
    const db = makeDb({
      accountOwner: 'owner-1',
      contactCandidates: [{ id: 'c1', phone: '14155550123' }],
      existingZernioConversation: { id: 'cv-zernio' },
    });
    const result = await resolveAgendaProWhatsApp(db, 'acct', '+14155550123', null, false, ZERNIO_CONNECTORS);
    expect(result).toEqual({ kind: 'conversation', conversationId: 'cv-zernio' });
  });

  it('asks for a template cold-start when the contact has no Zernio WhatsApp thread yet', async () => {
    const db = makeDb({
      accountOwner: 'owner-1',
      contactCandidates: [],
      insertedContactId: 'c-new',
      existingZernioConversation: null,
    });
    const result = await resolveAgendaProWhatsApp(db, 'acct', '+14155550123', 'Jane', false, ZERNIO_CONNECTORS);
    expect(result).toEqual({ kind: 'needs_template', contactId: 'c-new', connectors: ZERNIO_CONNECTORS });
  });
});
