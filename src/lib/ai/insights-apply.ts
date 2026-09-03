import type { SupabaseClient } from '@supabase/supabase-js'

import type { ConversationInsights } from './insights'

/** Queues are both the department vocabulary given to the model and the
 *  routing target it maps back to. */
export async function loadAccountQueues(
  db: SupabaseClient,
  accountId: string,
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await db
    .from('conversation_queues')
    .select('id, name')
    .eq('account_id', accountId)
    .order('name')
  if (error) {
    console.error('[ai insights] could not load queues:', error.message)
    return []
  }
  return (data ?? []) as { id: string; name: string }[]
}

/** Fill in identity the customer stated in the conversation, without ever
 *  overwriting what an agent (or a connector) already recorded. */
export async function enrichContactFromInsights(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  insights: Pick<ConversationInsights, 'customer_name' | 'company'>,
): Promise<void> {
  if (!insights.customer_name && !insights.company) return
  const { data: contact } = await db
    .from('contacts')
    .select('name, company, phone')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!contact) return

  const currentName = typeof contact.name === 'string' ? contact.name.trim() : ''
  // Connector placeholders ("Visitante web …", "Cliente Instagram …") and the
  // raw phone number count as "no name yet".
  const isPlaceholderName =
    !currentName ||
    currentName === String(contact.phone ?? '') ||
    /^(visitante web|cliente (facebook|instagram|whatsapp))/i.test(currentName)

  const update: Record<string, string> = {}
  if (insights.customer_name && isPlaceholderName) update.name = insights.customer_name
  if (insights.company && !String(contact.company ?? '').trim()) update.company = insights.company
  if (Object.keys(update).length === 0) return

  const { error } = await db.from('contacts').update(update).eq('id', contactId).eq('account_id', accountId)
  if (error) console.error('[ai insights] could not enrich contact:', error.message)
}

/** Move an unowned conversation to the department the analysis recommends and
 *  let that queue's own rules pick the agent. Never touches a thread a human
 *  already took. */
export async function routeConversationToQueue(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  queueId: string,
): Promise<void> {
  const { data: conversation } = await db
    .from('conversations')
    .select('assigned_agent_id, queue_id')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!conversation || conversation.assigned_agent_id || conversation.queue_id === queueId) return

  const { error } = await db
    .from('conversations')
    .update({ queue_id: queueId, updated_at: new Date().toISOString() })
    .eq('id', conversationId)
    .eq('account_id', accountId)
  if (error) {
    console.error('[ai insights] could not route conversation to queue:', error.message)
    return
  }
  const { error: assignError } = await db.rpc('auto_assign_inbound_conversation', {
    p_account_id: accountId,
    p_conversation_id: conversationId,
  })
  if (assignError) console.error('[ai insights] queue assignment failed:', assignError.message)
}
