import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_text: string | null
  media_transcript: string | null
  media_description: string | null
}

/**
 * Fetch the last N text messages of a conversation and map them to the
 * provider-neutral chat shape. Customer messages become `user`; agent
 * and bot messages become `assistant`. Non-text messages (media,
 * templates, interactive) are excluded — they carry no text to model.
 *
 * Ordered oldest-first (chronological) so the transcript reads
 * naturally and the most recent customer message lands last.
 */
export async function buildConversationContext(
  db: SupabaseClient,
  conversationId: string,
  limit: number = aiContextMessageLimit(),
): Promise<ChatMessage[]> {
  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_text, media_transcript, media_description')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()
  return rows
    .map((m) => {
      // Zernio-sourced media messages with no real caption store the
      // literal "no text" placeholder in content_text — treat that the
      // same as "no text" so it doesn't shadow the media analysis below.
      const text = m.content_text?.trim()
      if (text && text !== '[Mensaje sin texto]') return { role: m.sender_type === 'customer' ? 'user' as const : 'assistant' as const, content: text }
      if (m.media_transcript?.trim()) return { role: m.sender_type === 'customer' ? 'user' as const : 'assistant' as const, content: `[Nota de voz transcrita: ${m.media_transcript.trim()}]` }
      if (m.media_description?.trim()) return { role: m.sender_type === 'customer' ? 'user' as const : 'assistant' as const, content: `[Imagen recibida: ${m.media_description.trim()}]` }
      return null
    })
    .filter((message): message is ChatMessage => !!message)
}
