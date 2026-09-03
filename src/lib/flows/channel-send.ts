import type { InteractiveButton, InteractiveListSection } from '@/lib/whatsapp/interactive'
import { interactivePayloadToPlainText } from '@/lib/whatsapp/interactive'
import { sendOmnichannelText } from '@/lib/omnichannel/outbound-text'
import { resolveConversationChannel } from '@/lib/omnichannel/resolve-channel'
import type { ChannelType } from '@/types'

import { supabaseAdmin } from './admin-client'
import {
  engineSendInteractiveButtons,
  engineSendInteractiveList,
  engineSendMedia,
  engineSendText,
} from './meta-send'

/**
 * Channel-aware sending for the flow runner.
 *
 * Flows used to be reachable only from the native Meta WhatsApp webhook, so
 * every node sent through the Cloud API. Now a run can live on Zernio,
 * Messenger, Instagram or Yeastar Live Chat, where tappable buttons and
 * lists don't exist — those nodes degrade to numbered plain text, and the
 * customer answers with a number.
 *
 * Every helper returns the `messages.message_id` written for the send, which
 * is what the engine stores on the run and looks up afterwards.
 */

interface BaseArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
}

export async function flowChannel(accountId: string, conversationId: string): Promise<ChannelType> {
  return (await resolveConversationChannel(supabaseAdmin(), accountId, conversationId)) ?? 'whatsapp'
}

async function sendPlainText(args: BaseArgs & { text: string }): Promise<{ message_id: string }> {
  const channel = await flowChannel(args.accountId, args.conversationId)
  if (channel === 'whatsapp') {
    const { whatsapp_message_id } = await engineSendText({
      accountId: args.accountId,
      userId: args.userId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      text: args.text,
    })
    return { message_id: whatsapp_message_id }
  }
  const { message_id } = await sendOmnichannelText(supabaseAdmin(), {
    accountId: args.accountId,
    conversationId: args.conversationId,
    text: args.text,
    senderType: 'bot',
  })
  return { message_id }
}

export const flowSendText = sendPlainText

export async function flowSendMedia(
  args: BaseArgs & {
    mediaUrl: string
    mediaType: 'image' | 'video' | 'audio' | 'document'
    caption?: string
    filename?: string
  },
): Promise<{ message_id: string }> {
  const channel = await flowChannel(args.accountId, args.conversationId)
  if (channel === 'whatsapp') {
    const { whatsapp_message_id } = await engineSendMedia({
      accountId: args.accountId,
      userId: args.userId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      kind: args.mediaType,
      link: args.mediaUrl,
      caption: args.caption,
      filename: args.filename,
    })
    return { message_id: whatsapp_message_id }
  }
  // Other connectors take the file through their own upload endpoints; the
  // link keeps the step useful instead of failing the run.
  return sendPlainText({ ...args, text: [args.caption, args.mediaUrl].filter(Boolean).join('\n') })
}

export async function flowSendButtons(
  args: BaseArgs & {
    bodyText: string
    buttons: InteractiveButton[]
    headerText?: string
    footerText?: string
  },
): Promise<{ message_id: string; interactive: boolean }> {
  const channel = await flowChannel(args.accountId, args.conversationId)
  if (channel === 'whatsapp') {
    const { whatsapp_message_id } = await engineSendInteractiveButtons({
      accountId: args.accountId,
      userId: args.userId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      bodyText: args.bodyText,
      headerText: args.headerText,
      footerText: args.footerText,
      buttons: args.buttons,
    })
    return { message_id: whatsapp_message_id, interactive: true }
  }
  const text = interactivePayloadToPlainText({
    kind: 'buttons',
    body: args.bodyText,
    header: args.headerText,
    footer: args.footerText,
    buttons: args.buttons,
  })
  const { message_id } = await sendPlainText({ ...args, text })
  return { message_id, interactive: false }
}

export async function flowSendList(
  args: BaseArgs & {
    bodyText: string
    buttonLabel: string
    sections: InteractiveListSection[]
    headerText?: string
    footerText?: string
  },
): Promise<{ message_id: string; interactive: boolean }> {
  const channel = await flowChannel(args.accountId, args.conversationId)
  if (channel === 'whatsapp') {
    const { whatsapp_message_id } = await engineSendInteractiveList({
      accountId: args.accountId,
      userId: args.userId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      bodyText: args.bodyText,
      buttonLabel: args.buttonLabel,
      headerText: args.headerText,
      footerText: args.footerText,
      sections: args.sections,
    })
    return { message_id: whatsapp_message_id, interactive: true }
  }
  const text = interactivePayloadToPlainText({
    kind: 'list',
    body: args.bodyText,
    header: args.headerText,
    footer: args.footerText,
    button_label: args.buttonLabel,
    sections: args.sections,
  })
  const { message_id } = await sendPlainText({ ...args, text })
  return { message_id, interactive: false }
}

/**
 * Match a customer's plain-text answer against the options of a menu that
 * was delivered as numbered text. Accepts the number ("2"), the exact
 * option title, or a case/accent-insensitive match of it.
 */
export function matchNumberedOption(
  reply: string,
  options: { id: string; title: string }[],
): string | null {
  const normalize = (value: string) =>
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .trim()
      .toLowerCase()
  const answer = normalize(reply)
  if (!answer) return null

  const asNumber = Number(answer.replace(/[^\d]/g, ''))
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= options.length) {
    return options[asNumber - 1].id
  }
  return options.find((option) => normalize(option.title) === answer)?.id ?? null
}
