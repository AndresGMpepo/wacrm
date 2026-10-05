import type { SupabaseClient } from '@supabase/supabase-js'
import type { Message } from '@/types'

export function zernioOutboundIsHuman(message: Record<string, unknown>): boolean {
  // Null lineage is explicitly "unknown", not a human, in the webhook contract.
  return message.sentVia === 'human' || message.source === 'whatsapp_business_app'
}

export interface ZernioOutboundMessage {
  accountId: string
  connectorId: string
  conversationId: string
  internalId: string | null
  platformId?: string | null
  local: boolean
  message: {
    sender_type: 'agent' | 'bot'
    sender_id?: string | null
    content_type: Message['content_type']
    content_text: string | null
    media_url?: string | null
    template_name?: string | null
    ai_generated?: boolean
    created_at: string
  }
}

/** Both the send response and its webhook persist through the same DB lock. */
export async function persistZernioOutbound(
  db: SupabaseClient,
  args: ZernioOutboundMessage,
): Promise<Message> {
  const providerId = args.internalId || args.platformId
  if (!providerId) {
    throw new Error('El mensaje saliente no tiene un identificador verificable.')
  }
  const { data, error } = await db.rpc('persist_zernio_outbound_message', {
    p_account_id: args.accountId,
    p_connector_id: args.connectorId,
    p_conversation_id: args.conversationId,
    p_internal_id: args.internalId,
    p_platform_id: args.platformId ?? null,
    p_local: args.local,
    p_message: args.message,
    p_fallback_id: providerId,
  })
  if (error) throw error
  if (!data || typeof data.id !== 'string') {
    throw new Error('No se pudo registrar el mensaje saliente.')
  }
  return data as Message
}
