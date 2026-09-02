// ============================================================
// If an inbound message's sender is on a still-unreplied
// broadcast_recipients row, flip it to `replied` so the reply count
// advances on the parent broadcast.
//
// Shared by both the native (direct Meta) and Zernio-connected
// WhatsApp webhooks so a reply counts as "replied" regardless of
// which channel the customer answers on.
//
// Runs on a best-effort basis — failures here must not break the
// main inbound-message flow, so errors are swallowed with a log.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

export async function flagBroadcastReplyIfAny(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  conversationId: string,
) {
  try {
    // Most recent outbound broadcast in this account that hasn't
    // been replied to yet. Account-scoped so a shared inbox reply
    // marks the broadcast as replied regardless of which teammate
    // (or channel) sent it.
    const { data: recs, error } = await db
      .from('broadcast_recipients')
      .select('id, status, broadcast_id, broadcasts!inner(account_id)')
      .eq('contact_id', contactId)
      .eq('broadcasts.account_id', accountId)
      .in('status', ['sent', 'delivered', 'read'])
      .order('created_at', { ascending: false })
      .limit(1)

    if (error || !recs || recs.length === 0) return

    const row = recs[0]
    const { error: updErr } = await db
      .from('broadcast_recipients')
      .update({
        status: 'replied',
        replied_at: new Date().toISOString(),
        response_conversation_id: conversationId,
      })
      .eq('id', row.id)

    if (updErr) {
      console.error('Error marking broadcast recipient replied:', updErr)
    }
  } catch (err) {
    console.error('flagBroadcastReplyIfAny failed:', err)
  }
}
