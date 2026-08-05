import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { buildConversationContext } from '@/lib/ai/context'
import { generateText } from '@/lib/ai/generate'
import { logAiUsage } from '@/lib/ai/usage'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { AiError } from '@/lib/ai/types'

type Sentiment = 'positive' | 'neutral' | 'negative' | 'mixed'

type Analysis = {
  summary: string
  sentiment: Sentiment
  sentiment_score: number
  next_best_action: string
  reasons: string[]
}

function parseAnalysis(raw: string): Analysis {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new AiError('The AI did not return a valid analysis.', { code: 'invalid_analysis' })
  const data = JSON.parse(match[0]) as Record<string, unknown>
  const sentiment = data.sentiment
  if (!['positive', 'neutral', 'negative', 'mixed'].includes(String(sentiment))) {
    throw new AiError('The AI returned an invalid sentiment.', { code: 'invalid_analysis' })
  }
  const score = Math.round(Number(data.sentiment_score))
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new AiError('The AI returned an invalid sentiment score.', { code: 'invalid_analysis' })
  }
  return {
    summary: String(data.summary ?? '').trim().slice(0, 2000),
    sentiment: sentiment as Sentiment,
    sentiment_score: score,
    next_best_action: String(data.next_best_action ?? '').trim().slice(0, 1000),
    reasons: Array.isArray(data.reasons)
      ? data.reasons.filter((reason): reason is string => typeof reason === 'string').slice(0, 4)
      : [],
  }
}

async function assertConversation(accountId: string, conversationId: string, supabase: Awaited<ReturnType<typeof requireRole>>['supabase']) {
  const { data, error } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .maybeSingle()
  if (error) throw error
  if (!data) return false
  return true
}

export async function GET(_: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { conversationId } = await params
    if (!await assertConversation(accountId, conversationId, supabase)) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }
    const { data, error } = await supabase
      .from('ai_conversation_analyses')
      .select('summary, sentiment, sentiment_score, next_best_action, reasons, status, analyzed_message_count, analyzed_at')
      .eq('conversation_id', conversationId)
      .eq('source', 'whatsapp')
      .maybeSingle()
    if (error) throw error
    return NextResponse.json({ analysis: data ?? null })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(_: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const { conversationId } = await params
    const limit = checkRateLimit(`ai-analysis:${userId}`, RATE_LIMITS.aiDraft)
    if (!limit.success) return rateLimitResponse(limit)
    if (!await assertConversation(accountId, conversationId, supabase)) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const config = await loadAiConfig(supabase, accountId)
    if (!config) {
      return NextResponse.json({ error: 'Configura y activa la IA antes de analizar conversaciones.' }, { status: 400 })
    }
    const messages = await buildConversationContext(supabase, conversationId)
    if (!messages.length) {
      return NextResponse.json({ error: 'No hay mensajes de texto para analizar.' }, { status: 400 })
    }

    const systemPrompt = [
      'Analiza esta conversación de atención al cliente. Responde únicamente JSON válido, sin markdown.',
      'Usa exactamente esta forma: {"summary":"...","sentiment":"positive|neutral|negative|mixed","sentiment_score":0,"next_best_action":"...","reasons":["..."]}.',
      'El resumen y la acción deben estar en español, ser breves y basarse solamente en la conversación.',
      'sentiment_score es 0 muy negativo y 100 muy positivo. No inventes datos ni atribuyas intención con certeza.',
      config.systemPrompt ? `Contexto del negocio: ${config.systemPrompt}` : '',
    ].filter(Boolean).join('\n\n')
    const result = await generateText({ config, systemPrompt, messages })
    const analysis = parseAnalysis(result.text)

    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('ai_conversation_analyses')
      .upsert({
        account_id: accountId,
        conversation_id: conversationId,
        source: 'whatsapp',
        status: 'completed',
        ...analysis,
        model: config.model,
        analyzed_message_count: messages.length,
        analyzed_at: new Date().toISOString(),
        error_message: null,
      }, { onConflict: 'conversation_id,source' })
      .select('summary, sentiment, sentiment_score, next_best_action, reasons, status, analyzed_message_count, analyzed_at')
      .single()
    if (error) throw error
    void logAiUsage(admin, { accountId, conversationId, mode: 'analysis', provider: config.provider, model: config.model, usage: result.usage })
    return NextResponse.json({ analysis: data })
  } catch (error) {
    if (error instanceof AiError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    return toErrorResponse(error)
  }
}
