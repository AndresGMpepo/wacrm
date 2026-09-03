import type { SupabaseClient } from '@supabase/supabase-js'

import type { ChannelType } from '@/types'

const CHANNELS = new Set<string>([
  'whatsapp',
  'zernio_whatsapp',
  'zernio_facebook',
  'zernio_instagram',
  'facebook',
  'instagram',
  'tiktok',
  'yeastar_live_chat',
])

export function isChannelType(value: unknown): value is ChannelType {
  return typeof value === 'string' && CHANNELS.has(value)
}

/**
 * Channel a conversation belongs to. Rows created before omnichannel
 * support default to the native WhatsApp connection, which is also the
 * column's own default.
 */
export async function resolveConversationChannel(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
): Promise<ChannelType | null> {
  const { data, error } = await db
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
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<ChannelType | null> {
  const { data, error } = await db
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
