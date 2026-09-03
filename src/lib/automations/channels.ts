import type { ChannelType } from '@/types'

/**
 * Channel scoping for automations.
 *
 * Until migration 106 the engine was only reachable from the native Meta
 * WhatsApp webhook, so "automation" implicitly meant "WhatsApp automation".
 * Now every inbound channel dispatches triggers, and each automation can
 * either react to all of them (`channel_types = null`) or to an explicit
 * subset.
 */

export const AUTOMATION_CHANNELS: ChannelType[] = [
  'whatsapp',
  'zernio_whatsapp',
  'zernio_facebook',
  'zernio_instagram',
  'facebook',
  'instagram',
  'yeastar_live_chat',
  'tiktok',
]

const CHANNEL_SET = new Set<string>(AUTOMATION_CHANNELS)

export function isChannelType(value: unknown): value is ChannelType {
  return typeof value === 'string' && CHANNEL_SET.has(value)
}

/**
 * Normalize whatever the API received into either `null` (all channels) or
 * a deduplicated list of known channels. An empty array is treated as "all"
 * so the builder can send `[]` for the default state.
 */
export function normalizeChannelTypes(value: unknown): ChannelType[] | null {
  if (!Array.isArray(value)) return null
  const picked = AUTOMATION_CHANNELS.filter((channel) => value.includes(channel))
  if (picked.length === 0 || picked.length === AUTOMATION_CHANNELS.length) return null
  return picked
}

/**
 * Does an automation scoped to `channelTypes` react to an event that arrived
 * on `channelType`?
 *
 * `null`/empty scope matches everything. A scoped automation refuses to run
 * when the channel is unknown — the user asked for a specific channel and
 * firing "just in case" could send a WhatsApp-only reply into a web chat.
 */
export function automationMatchesChannel(
  channelTypes: string[] | null | undefined,
  channelType: ChannelType | null | undefined,
): boolean {
  if (!channelTypes || channelTypes.length === 0) return true
  if (!channelType) return false
  return channelTypes.includes(channelType)
}

/** Interactive buttons / lists are a Meta Cloud API (direct WhatsApp) feature. */
export function channelSupportsInteractive(channelType: ChannelType): boolean {
  return channelType === 'whatsapp'
}

/** Approved WhatsApp templates exist on both WhatsApp connections. */
export function channelSupportsTemplates(channelType: ChannelType): boolean {
  return channelType === 'whatsapp' || channelType === 'zernio_whatsapp'
}
