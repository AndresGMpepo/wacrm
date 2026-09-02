// ============================================================
// Mirrors an outbound broadcast template send into the normal
// conversations/messages tables.
//
// Broadcasts previously only recorded state in broadcast_recipients —
// invisible in the inbox — so when a customer replied to a broadcasted
// template, the agent had no idea what template prompted the reply.
// This makes the send show up as a normal outbound message in the
// contact's thread, same as any agent/bot send.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { isUniqueViolation } from '@/lib/contacts/dedupe'

interface RecordBroadcastMessageArgs {
  db: SupabaseClient
  accountId: string
  userId: string
  contactId: string
  channelType: string
  connectorId?: string | null
  /** Zernio's own conversation id — lets a later inbound reply (matched
   *  by external_session_id in the connector webhook) land in this same
   *  thread instead of creating a duplicate. */
  externalSessionId?: string | null
  templateName: string
  whatsappMessageId: string
}

async function lookupConversationId(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  channelType: string,
  connectorId?: string | null,
): Promise<{ id: string; external_session_id: string | null } | null> {
  let query = db
    .from('conversations')
    .select('id, external_session_id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('channel_type', channelType)
  if (connectorId) query = query.eq('connector_id', connectorId)
  const { data, error } = await query.order('created_at', { ascending: true }).limit(1)
  if (error) throw error
  return data?.[0] ?? null
}

export async function recordBroadcastMessage(args: RecordBroadcastMessageArgs): Promise<void> {
  const { db, accountId, userId, contactId, channelType, connectorId, externalSessionId, templateName, whatsappMessageId } = args
  try {
    const existing = await lookupConversationId(db, accountId, contactId, channelType, connectorId)
    let conversationId = existing?.id

    if (!conversationId) {
      const { data: created, error: createError } = await db
        .from('conversations')
        .insert({
          account_id: accountId,
          user_id: userId,
          contact_id: contactId,
          channel_type: channelType,
          connector_id: connectorId ?? null,
          external_session_id: externalSessionId ?? null,
        })
        .select('id')
        .single()
      if (createError || !created) {
        // Lost a race against a concurrent send/inbound create.
        if (isUniqueViolation(createError)) {
          conversationId = (await lookupConversationId(db, accountId, contactId, channelType, connectorId))?.id
        }
        if (!conversationId) throw createError ?? new Error('conversation create failed')
      } else {
        conversationId = created.id
      }
    } else if (existing && externalSessionId && !existing.external_session_id) {
      await db.from('conversations').update({ external_session_id: externalSessionId }).eq('id', conversationId)
    }

    const now = new Date().toISOString()
    const { error: msgError } = await db.from('messages').insert({
      conversation_id: conversationId,
      sender_type: 'bot',
      content_type: 'template',
      template_name: templateName,
      message_id: whatsappMessageId,
      status: 'sent',
      created_at: now,
    })
    if (msgError) throw msgError

    await db
      .from('conversations')
      .update({ last_message_text: `Plantilla: ${templateName}`, last_message_at: now, updated_at: now })
      .eq('id', conversationId)
  } catch (err) {
    // Best-effort mirror — a broadcast send must not fail because the
    // inbox thread couldn't be written.
    console.error('[recordBroadcastMessage] failed:', err)
  }
}
