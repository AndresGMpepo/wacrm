// ============================================================
// Resolve "Hablar por WhatsApp" from the AgendaPro calendar popover
// for a client phone number, regardless of which WhatsApp integration
// the account actually uses:
//
//  - Native Meta Cloud API (`whatsapp_config`): behaves exactly like
//    before — find-or-create the contact + conversation and hand the
//    agent straight to the Inbox thread, where typing/templates are
//    already fully handled (including a cold Meta 24h session).
//
//  - Zernio-connected WhatsApp (`omnichannel_connectors`, provider
//    'zernio_whatsapp'): a Zernio conversation can only be opened by
//    actually sending an approved template through Zernio's API (see
//    POST /api/omnichannel/zernio/send's cold-start branch and
//    ContactDetailView's "Enviar plantilla" flow) — there is no
//    "create an empty conversation and type into it later" option,
//    because Zernio only hands back a usable `external_session_id`
//    once that first template send succeeds. So if the contact has no
//    existing Zernio WhatsApp thread yet, this returns `needs_template`
//    instead of a conversation id, and the popover sends the agent to
//    the Contact page's existing template-cold-start UI rather than a
//    broken/blank Inbox thread.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { findOrCreateContactByPhone, resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import { SendMessageError } from '@/lib/whatsapp/send-message';
import { resolveAuditUserId, ContactError } from '@/lib/api/v1/contacts';

export type AgendaProWhatsAppResolution =
  | { kind: 'conversation'; conversationId: string }
  | { kind: 'needs_template'; contactId: string; connectors: { id: string; displayName: string }[] };

export async function resolveAgendaProWhatsApp(
  db: SupabaseClient,
  accountId: string,
  phone: string,
  name: string | null | undefined,
  hasNativeWhatsApp: boolean,
  zernioWhatsappConnectors: { id: string; displayName: string }[]
): Promise<AgendaProWhatsAppResolution> {
  const sanitized = sanitizePhoneForMeta(phone);
  if (!isValidE164(sanitized)) {
    throw new SendMessageError(
      'bad_request',
      "'to' must be a valid phone number in E.164 format (e.g. +14155550123)",
      400
    );
  }

  if (hasNativeWhatsApp) {
    const { conversationId } = await resolveConversationByPhone(db, accountId, phone, name);
    return { kind: 'conversation', conversationId };
  }

  if (zernioWhatsappConnectors.length === 0) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp no está conectado. Conecta tu número en Configuración → WhatsApp.',
      400
    );
  }

  let ownerUserId: string;
  try {
    ownerUserId = await resolveAuditUserId(db, accountId);
  } catch (err) {
    if (err instanceof ContactError) {
      throw new SendMessageError('db_error', err.message, err.status);
    }
    throw err;
  }

  const { contactId } = await findOrCreateContactByPhone(db, accountId, sanitized, name, ownerUserId);

  // Only a conversation that already has a real `external_session_id`
  // (i.e. Zernio actually has a thread for it — either the client wrote
  // in first, or an earlier template cold-start succeeded) can receive
  // a free-text message from the Inbox right now.
  const { data: existingConversations, error: convError } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('channel_type', 'zernio_whatsapp')
    .not('external_session_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1);
  if (convError) {
    console.error('[agendapro] conversation lookup error:', convError);
    throw new SendMessageError('db_error', 'Failed to resolve conversation', 500);
  }

  if (existingConversations && existingConversations.length > 0) {
    return { kind: 'conversation', conversationId: existingConversations[0].id };
  }

  return { kind: 'needs_template', contactId, connectors: zernioWhatsappConnectors };
}
