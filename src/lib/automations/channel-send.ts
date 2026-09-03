import type { ChannelType, InteractiveMessagePayload } from '@/types'

import { supabaseAdmin } from './admin-client'
import { channelSupportsInteractive, channelSupportsTemplates, isChannelType } from './channels'
import { engineSendInteractive, engineSendTemplate, engineSendText } from './meta-send'
import { interactivePayloadToPlainText } from '@/lib/whatsapp/interactive'
import { sendOmnichannelText } from '@/lib/omnichannel/outbound-text'
import { sendZernioTemplateMessage } from '@/lib/zernio/server'

interface SendArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  channelType: ChannelType
}

/** Read the channel a conversation belongs to (defaults to WhatsApp for
 *  pre-omnichannel rows, whose `channel_type` column defaults to it). */
export async function resolveConversationChannel(
  accountId: string,
  conversationId: string,
): Promise<ChannelType | null> {
  const { data, error } = await supabaseAdmin()
    .from('conversations')
    .select('channel_type')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data) return null
  return isChannelType(data.channel_type) ? data.channel_type : 'whatsapp'
}

/** Same, from the contact's most recent conversation. */
export async function resolveContactChannel(
  accountId: string,
  contactId: string,
): Promise<ChannelType | null> {
  const { data, error } = await supabaseAdmin()
    .from('conversations')
    .select('channel_type')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return isChannelType(data.channel_type) ? data.channel_type : 'whatsapp'
}

/**
 * Send a plain-text automation message on whatever channel the
 * conversation belongs to. Returns a human-readable detail string for the
 * automation log.
 */
export async function sendAutomationText(args: SendArgs & { text: string }): Promise<string> {
  if (args.channelType === 'whatsapp') {
    const { whatsapp_message_id } = await engineSendText({
      accountId: args.accountId,
      userId: args.userId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      text: args.text,
    })
    return `sent via Meta (${whatsapp_message_id})`
  }

  const { external_message_id } = await sendOmnichannelText(supabaseAdmin(), {
    accountId: args.accountId,
    conversationId: args.conversationId,
    text: args.text,
    senderType: 'bot',
  })
  return `sent via ${args.channelType} (${external_message_id ?? 'no id'})`
}

export async function sendAutomationInteractive(
  args: SendArgs & { payload: InteractiveMessagePayload },
): Promise<string> {
  if (!channelSupportsInteractive(args.channelType)) {
    // Only the Meta Cloud API renders real buttons/lists. Everywhere else
    // the menu is delivered as numbered plain text so the automation still
    // works instead of failing the step.
    const text = interactivePayloadToPlainText(args.payload)
    if (!text.trim()) throw new Error('interactive step has no text to send')
    const { external_message_id } = await sendOmnichannelText(supabaseAdmin(), {
      accountId: args.accountId,
      conversationId: args.conversationId,
      text,
      senderType: 'bot',
    })
    return `sent as plain text on ${args.channelType} — this channel has no interactive buttons/lists (${external_message_id ?? 'no id'})`
  }
  const { whatsapp_message_id } = await engineSendInteractive({
    accountId: args.accountId,
    userId: args.userId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    payload: args.payload,
  })
  return `interactive sent via Meta (${whatsapp_message_id})`
}

export async function sendAutomationTemplate(
  args: SendArgs & { templateName: string; language?: string; params: string[] },
): Promise<string> {
  if (!channelSupportsTemplates(args.channelType)) {
    throw new Error(
      `WhatsApp templates do not exist on ${args.channelType}; use a Send Message step for this channel`,
    )
  }

  if (args.channelType === 'whatsapp') {
    const { whatsapp_message_id } = await engineSendTemplate({
      accountId: args.accountId,
      userId: args.userId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      templateName: args.templateName,
      language: args.language,
      params: args.params,
    })
    return `template sent via Meta (${whatsapp_message_id})`
  }

  // zernio_whatsapp — Zernio proxies Meta's template API, and the send is
  // keyed on the recipient phone rather than the inbox conversation id.
  const db = supabaseAdmin()
  const [{ data: contact }, { data: conversation }] = await Promise.all([
    db.from('contacts').select('phone').eq('id', args.contactId).eq('account_id', args.accountId).maybeSingle(),
    db
      .from('conversations')
      .select('connector_id')
      .eq('id', args.conversationId)
      .eq('account_id', args.accountId)
      .maybeSingle(),
  ])
  const phone = typeof contact?.phone === 'string' ? contact.phone.trim() : ''
  if (!phone || phone.startsWith('zernio:')) {
    throw new Error('send_template: the contact has no WhatsApp phone number')
  }
  if (!conversation?.connector_id) throw new Error('send_template: conversation has no connected channel')
  const { data: connector } = await db
    .from('omnichannel_connectors')
    .select('zernio_account_id, status')
    .eq('id', conversation.connector_id)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (!connector?.zernio_account_id || connector.status === 'paused') {
    throw new Error('send_template: the connected WhatsApp channel is paused or needs reconnection')
  }

  const { messageId } = await sendZernioTemplateMessage({
    zernioAccountId: connector.zernio_account_id as string,
    phone,
    templateName: args.templateName,
    templateLanguage: args.language ?? 'es',
    templateParams: args.params,
  })
  const now = new Date().toISOString()
  await db.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: 'bot',
    content_type: 'template',
    content_text: args.templateName,
    message_id: `zernio:out:${conversation.connector_id}:${messageId}`,
    platform_message_id: messageId,
    status: 'sent',
    created_at: now,
  })
  await db
    .from('conversations')
    .update({ last_message_text: args.templateName, last_message_at: now, updated_at: now })
    .eq('id', args.conversationId)
    .eq('account_id', args.accountId)
  return `template sent via Zernio (${messageId})`
}
