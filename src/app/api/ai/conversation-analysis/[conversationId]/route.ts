import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { buildConversationContext } from '@/lib/ai/context'
import { generateText } from '@/lib/ai/generate'
import { logAiUsage } from '@/lib/ai/usage'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { AiError } from '@/lib/ai/types'
import { applyContactMemory, parseMemoryExtraction } from '@/lib/ai/memory'
import {
  INSIGHTS_PROMPT,
  departmentsPrompt,
  matchDepartmentQueue,
  parseConversationInsights,
} from '@/lib/ai/insights'
import {
  enrichContactFromInsights,
  loadAccountQueues,
  routeConversationToQueue,
} from '@/lib/ai/insights-apply'
import { MIN_DAILY_ANALYSES_PER_CONVERSATION } from '@/lib/ai/defaults'

const ANALYSIS_COLUMNS =
  'summary, sentiment, sentiment_score, next_best_action, reasons, qa_score, qa_empathy_score, qa_objection_handling_score, qa_script_adherence_score, qa_summary, qa_findings, insights, intent, urgency, lead_temperature, handoff_required, recommended_department, status, analyzed_message_count, analyzed_at'

type Sentiment = 'positive' | 'neutral' | 'negative' | 'mixed'

function startOfDay() {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date.toISOString()
}

type Analysis = {
  summary: string
  sentiment: Sentiment
  sentiment_score: number
  next_best_action: string
  reasons: string[]
  qa_score: number | null
  qa_empathy_score: number | null
  qa_objection_handling_score: number | null
  qa_script_adherence_score: number | null
  qa_summary: string | null
  qa_findings: string[]
}

function parseAnalysis(data: Record<string, unknown>): Analysis {
  const sentiment = data.sentiment
  if (!['positive', 'neutral', 'negative', 'mixed'].includes(String(sentiment))) {
    throw new AiError('The AI returned an invalid sentiment.', { code: 'invalid_analysis' })
  }
  const score = Math.round(Number(data.sentiment_score))
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new AiError('The AI returned an invalid sentiment score.', { code: 'invalid_analysis' })
  }
  const qaScore = (value: unknown) => {
    const parsed = Math.round(Number(value))
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null
  }
  return {
    summary: String(data.summary ?? '').trim().slice(0, 2000),
    sentiment: sentiment as Sentiment,
    sentiment_score: score,
    next_best_action: String(data.next_best_action ?? '').trim().slice(0, 1000),
    reasons: Array.isArray(data.reasons)
      ? data.reasons.filter((reason): reason is string => typeof reason === 'string').slice(0, 4)
      : [],
    qa_score: qaScore(data.qa_score),
    qa_empathy_score: qaScore(data.qa_empathy_score),
    qa_objection_handling_score: qaScore(data.qa_objection_handling_score),
    qa_script_adherence_score: qaScore(data.qa_script_adherence_score),
    qa_summary: typeof data.qa_summary === 'string' ? data.qa_summary.trim().slice(0, 1500) : null,
    qa_findings: Array.isArray(data.qa_findings)
      ? data.qa_findings.filter((finding): finding is string => typeof finding === 'string').slice(0, 5)
      : [],
  }
}

async function assertConversation(accountId: string, conversationId: string, supabase: Awaited<ReturnType<typeof requireRole>>['supabase']) {
  const { data, error } = await supabase
    .from('conversations')
    .select('id, contact_id')
    .eq('id', conversationId)
    .maybeSingle()
  if (error) throw error
  return data ?? null
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
      .select(ANALYSIS_COLUMNS)
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
    const conversation = await assertConversation(accountId, conversationId, supabase)
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const config = await loadAiConfig(supabase, accountId)
    if (!config) {
      return NextResponse.json({ error: 'Configura y activa la IA antes de analizar conversaciones.' }, { status: 400 })
    }
    // Analyzing while an image/voice note is still being described/
    // transcribed locks in a summary that ignores that message's content —
    // block and let the agent retry once media analysis finishes (it also
    // auto-retriggers this analysis itself, see ai-analysis-worker).
    const { count: pendingMediaCount } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .eq('sender_type', 'customer')
      .not('media_url', 'is', null)
      .in('media_analysis_status', ['queued', 'processing'])
    if ((pendingMediaCount ?? 0) > 0) {
      return NextResponse.json({
        error: 'Hay una imagen o nota de voz aún en análisis. Espera a que termine para tener el contexto completo.',
        code: 'media_analysis_pending',
      }, { status: 409 })
    }
    const messages = await buildConversationContext(supabase, conversationId)
    if (!messages.length) {
      return NextResponse.json({ error: 'No hay mensajes de texto para analizar.' }, { status: 400 })
    }

    const { data: qaPolicy } = await supabase
      .from('ai_configs')
      .select('qa_scoring_enabled, qa_scoring_criteria, analysis_max_per_conversation, analysis_auto_route_enabled')
      .eq('account_id', accountId)
      .maybeSingle()
    const conversationLimit = Math.max(
      MIN_DAILY_ANALYSES_PER_CONVERSATION,
      Number(qaPolicy?.analysis_max_per_conversation) || MIN_DAILY_ANALYSES_PER_CONVERSATION,
    )
    const { count: conversationCount, error: usageError } = await supabase
      .from('ai_usage_log')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('conversation_id', conversationId)
      .eq('mode', 'analysis')
      .gte('created_at', startOfDay())
    if (usageError) throw usageError
    if ((conversationCount ?? 0) >= conversationLimit) {
      return NextResponse.json({
        error: `El límite diario de análisis para esta conversación fue alcanzado (${Math.min(conversationCount ?? 0, conversationLimit)}/${conversationLimit}).`,
        code: 'analysis_conversation_limit',
      }, { status: 429 })
    }
    const qaEnabled = qaPolicy?.qa_scoring_enabled === true
    const queues = await loadAccountQueues(supabase, accountId)
    const systemPrompt = [
      'Analiza esta conversación de atención al cliente. Responde únicamente JSON válido, sin markdown.',
      'Usa exactamente esta forma: {"summary":"...","sentiment":"positive|neutral|negative|mixed","sentiment_score":0,"next_best_action":"...","reasons":["..."]}.',
      'El resumen y la acción deben estar en español, ser breves y basarse solamente en la conversación.',
      'sentiment_score es 0 muy negativo y 100 muy positivo. No inventes datos ni atribuyas intención con certeza.',
      qaEnabled
        ? 'Incluye además QA interno: "qa_score":0-100, "qa_empathy_score":0-100, "qa_objection_handling_score":0-100, "qa_script_adherence_score":0-100, "qa_summary":"...", "qa_findings":["..."]. Evalúa solo lo observable. Si no hubo objeciones o no existe un guion aplicable, indícalo y usa puntuación neutral; no inventes penalizaciones.'
        : '',
      qaEnabled && qaPolicy?.qa_scoring_criteria
        ? `Criterios propios de la cuenta para QA: ${qaPolicy.qa_scoring_criteria}`
        : '',
      config.systemPrompt ? `Contexto del negocio: ${config.systemPrompt}` : '',
      'Incluye también memoria del cliente (Nexo Memory): "customer_stage":"..." (p.ej. prospecto, cotización, propuesta, cliente), "risk_level":"low|medium|high", "opportunity_score":0-100, "interests":[{"text":"...","confidence":0-1}], "objections":[{"text":"...","confidence":0-1}], "commitments":[{"description":"...","owner":"agent|customer","due_date":"YYYY-MM-DD|null"}], "important_facts":["..."] (hechos nuevos y relevantes, no saludos ni trivialidades). Omite cualquier campo del que no tengas evidencia clara.',
      INSIGHTS_PROMPT + departmentsPrompt(queues.map((q) => q.name)),
    ].filter(Boolean).join('\n\n')
    const analysisConfig = { ...config, model: config.analysisModel ?? config.model }
    const result = await generateText({ config: analysisConfig, systemPrompt, messages })
    const match = result.text.match(/\{[\s\S]*\}/)
    if (!match) throw new AiError('The AI did not return a valid analysis.', { code: 'invalid_analysis' })
    const rawValue = JSON.parse(match[0]) as Record<string, unknown>
    const analysis = parseAnalysis(rawValue)
    const insights = parseConversationInsights(rawValue)
    const recommendedQueueId = matchDepartmentQueue(queues, insights.recommended_department)

    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('ai_conversation_analyses')
      .upsert({
        account_id: accountId,
        conversation_id: conversationId,
        source: 'whatsapp',
        status: 'completed',
        ...analysis,
        insights,
        intent: insights.intent,
        urgency: insights.urgency,
        lead_temperature: insights.lead_temperature,
        handoff_required: insights.handoff_required,
        recommended_department: insights.recommended_department,
        recommended_queue_id: recommendedQueueId,
        model: analysisConfig.model,
        analyzed_message_count: messages.length,
        analyzed_at: new Date().toISOString(),
        error_message: null,
      }, { onConflict: 'conversation_id,source' })
      .select(ANALYSIS_COLUMNS)
      .single()
    if (error) throw error
    void logAiUsage(admin, { accountId, conversationId, mode: 'analysis', provider: config.provider, model: analysisConfig.model, usage: result.usage })
    if (qaPolicy?.analysis_auto_route_enabled && insights.handoff_required && recommendedQueueId) {
      await routeConversationToQueue(admin, accountId, conversationId, recommendedQueueId)
    }
    if (conversation.contact_id) {
      const memory = parseMemoryExtraction(rawValue)
      memory.important_facts = [...memory.important_facts, ...insights.customer_context_update].slice(0, 8)
      await applyContactMemory(admin, { accountId, contactId: conversation.contact_id, source: { type: 'conversation', id: conversationId } }, analysis, memory).catch((memoryError) => {
        console.error('[nexo-memory] Failed to apply memory extraction:', memoryError)
      })
      await enrichContactFromInsights(admin, accountId, conversation.contact_id, insights)
    }
    return NextResponse.json({ analysis: data })
  } catch (error) {
    if (error instanceof AiError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    return toErrorResponse(error)
  }
}
