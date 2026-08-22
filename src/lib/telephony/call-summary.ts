import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAiConfig } from '@/lib/ai/config'
import { generateText } from '@/lib/ai/generate'
import { logAiUsage } from '@/lib/ai/usage'

const SYSTEM_PROMPT = `Eres un asistente que resume llamadas telefónicas de atención al cliente a partir de su transcripción.
Responde en español, en 3 a 6 viñetas breves, cubriendo: motivo de la llamada, puntos clave discutidos, resultado/acuerdo y próximos pasos si los hay.
No inventes información que no esté en la transcripción. Si la transcripción es demasiado corta o poco clara, dilo brevemente.`

/** Generate a call summary from its transcript using the account's own AI config. Returns null if AI isn't configured. */
export async function generateCallSummary(db: SupabaseClient, accountId: string, transcript: string): Promise<string | null> {
  const config = await loadAiConfig(db, accountId)
  if (!config) return null
  const { text, usage } = await generateText({
    config,
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: transcript.slice(0, 12_000) }],
  })
  await logAiUsage(db, {
    accountId,
    conversationId: null,
    mode: 'call_summary',
    provider: config.provider,
    model: config.model,
    usage,
  })
  return text.trim() || null
}
