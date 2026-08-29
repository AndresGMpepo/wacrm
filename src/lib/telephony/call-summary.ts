import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAiConfig } from '@/lib/ai/config'
import { generateText } from '@/lib/ai/generate'
import { logAiUsage } from '@/lib/ai/usage'
import { parseMemoryExtraction, type MemoryExtraction } from '@/lib/ai/memory'

const SYSTEM_PROMPT = `Eres un asistente que analiza llamadas telefónicas de atención al cliente a partir de su transcripción. Responde únicamente JSON válido, sin markdown, con exactamente esta forma:
{"summary":"...","key_points":["..."],"action_items":[{"description":"...","owner":"agent|customer","due_date":"YYYY-MM-DD|null"}],"sentiment":"positive|neutral|negative|mixed","sentiment_score":0,"next_best_action":"..."}
"summary": 3-6 viñetas breves en español (motivo de la llamada, puntos clave, resultado/acuerdo, próximos pasos) unidas en un solo texto.
"key_points": hasta 6 puntos clave discutidos, cada uno una frase corta.
"action_items": compromisos o pendientes explícitos de la llamada (quién debe hacer qué y para cuándo), vacío si no hubo ninguno.
"sentiment_score": 0 muy negativo, 100 muy positivo. No inventes información que no esté en la transcripción.
Incluye también memoria del cliente (Nexo Memory) en el mismo JSON: "customer_stage":"..." (p.ej. prospecto, cotización, propuesta, cliente), "risk_level":"low|medium|high", "opportunity_score":0-100, "interests":[{"text":"...","confidence":0-1}], "objections":[{"text":"...","confidence":0-1}], "important_facts":["..."] (hechos nuevos y relevantes, no saludos ni trivialidades). Omite cualquier campo del que no tengas evidencia clara.`

export type CallAnalysis = {
  summary: string
  key_points: string[]
  action_items: Array<{ description: string; owner: 'agent' | 'customer'; due_date: string | null }>
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed'
  sentiment_score: number
  next_best_action: string
  memory: MemoryExtraction
}

function parseCallAnalysis(raw: string): CallAnalysis | null {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null
  const value = JSON.parse(match[0]) as Record<string, unknown>
  const sentiment = String(value.sentiment)
  const memory = parseMemoryExtraction({ ...value, commitments: value.action_items })
  return {
    summary: String(value.summary ?? '').trim().slice(0, 2000),
    key_points: Array.isArray(value.key_points) ? value.key_points.filter((item): item is string => typeof item === 'string').map((item) => item.trim().slice(0, 300)).filter(Boolean).slice(0, 6) : [],
    action_items: memory.commitments,
    sentiment: (['positive', 'neutral', 'negative', 'mixed'] as const).includes(sentiment as 'positive' | 'neutral' | 'negative' | 'mixed') ? (sentiment as CallAnalysis['sentiment']) : 'neutral',
    sentiment_score: Math.min(100, Math.max(0, Math.round(Number(value.sentiment_score) || 0))),
    next_best_action: String(value.next_best_action ?? '').trim().slice(0, 1000),
    memory,
  }
}

/** Analyzes a call transcript (summary + key points + action items + Nexo Memory
 *  extraction) in a single AI call using the account's own AI config. Returns
 *  null if AI isn't configured or the model didn't return valid JSON. */
export async function analyzeCall(db: SupabaseClient, accountId: string, transcript: string): Promise<CallAnalysis | null> {
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
  return parseCallAnalysis(text)
}
