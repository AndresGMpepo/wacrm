import type { AutomationTriggerType, ChannelType } from '@/types'

import { runAutomationsForTrigger } from './engine'

export interface InboundAutomationDispatch {
  accountId: string
  contactId: string
  conversationId: string
  /** Inbox channel the message arrived on. */
  channelType: ChannelType
  messageText: string
  /** Button / list-row id, when the customer tapped an interactive reply. */
  interactiveReplyId?: string | null
  /** The inbound webhook just created the contact row. */
  contactCreated?: boolean
  /** This is the contact's first-ever customer-sent message. */
  isFirstInboundMessage?: boolean
  /**
   * A Flow consumed the message. Content-level triggers
   * (`new_message_received`, `keyword_match`, `interactive_reply`) are then
   * suppressed — the customer is navigating a bot menu, not sending a fresh
   * trigger word. Relationship-level triggers still fire.
   */
  flowConsumed?: boolean
}

/**
 * Single entry point every inbound channel uses to fire automations.
 *
 * Before this existed the trigger dispatch lived inline in the native Meta
 * WhatsApp webhook, which is why Zernio (WhatsApp / Facebook / Instagram),
 * native Meta Messenger & Instagram and Yeastar Live Chat messages never ran
 * a single automation. Keeping the trigger list in one place means a new
 * connector only has to call this once.
 *
 * Never throws — callers are webhooks that must still answer 200.
 */
export async function dispatchInboundAutomations(input: InboundAutomationDispatch): Promise<void> {
  const triggers: AutomationTriggerType[] = []
  if (!input.flowConsumed) {
    triggers.push('new_message_received', 'keyword_match')
    if (input.interactiveReplyId) triggers.push('interactive_reply')
  }
  // `new_contact_created` fires only when the webhook just created the
  // contact row. `first_inbound_message` is the superset that also catches
  // manually-imported contacts writing for the first time. Both are
  // dispatched so users can pick whichever semantic they want.
  if (input.contactCreated) triggers.unshift('new_contact_created')
  if (input.isFirstInboundMessage) triggers.unshift('first_inbound_message')

  for (const triggerType of triggers) {
    // Awaited on purpose: webhooks run this inside `after()` / a request
    // scope that only stays alive for promises it can see, so a detached
    // dispatch can be frozen half-way through. `runAutomationsForTrigger`
    // owns its own try/catch; the `.catch` keeps one trigger's failure from
    // skipping the rest of the loop.
    await runAutomationsForTrigger({
      accountId: input.accountId,
      triggerType,
      contactId: input.contactId,
      channelType: input.channelType,
      context: {
        message_text: input.messageText,
        conversation_id: input.conversationId,
        channel_type: input.channelType,
        interactive_reply_id: input.interactiveReplyId ?? undefined,
      },
    }).catch((err) => console.error('[automations] dispatch failed:', err))
  }
}
