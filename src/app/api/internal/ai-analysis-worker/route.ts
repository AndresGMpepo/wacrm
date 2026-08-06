import { NextResponse } from 'next/server'
import { loadAiConfig } from '@/lib/ai/config'
import { buildConversationContext } from '@/lib/ai/context'
import { generateText } from '@/lib/ai/generate'
import { logAiUsage } from '@/lib/ai/usage'
import { supabaseAdmin } from '@/lib/ai/admin-client'

export const maxDuration = 60

type Job = { id: string; account_id: string; conversation_id: string }

function startOfDay() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString() }
function startOfMonth() { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.toISOString() }

function parse(raw: string) {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('La IA no devolvió JSON válido.')
  const value = JSON.parse(match[0]) as Record<string, unknown>
  const sentiment = String(value.sentiment)
  if (!['positive', 'neutral', 'negative', 'mixed'].includes(sentiment)) throw new Error('Sentimiento inválido.')
  const qaScore = (value: unknown) => {
    const parsed = Math.round(Number(value))
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null
  }
  return {
    summary: String(value.summary ?? '').trim().slice(0, 2000),
    sentiment,
    sentiment_score: Math.min(100, Math.max(0, Math.round(Number(value.sentiment_score) || 0))),
    next_best_action: String(value.next_best_action ?? '').trim().slice(0, 1000),
    reasons: Array.isArray(value.reasons) ? value.reasons.filter((x): x is string => typeof x === 'string').slice(0, 4) : [],
    qa_score: qaScore(value.qa_score),
    qa_empathy_score: qaScore(value.qa_empathy_score),
    qa_objection_handling_score: qaScore(value.qa_objection_handling_score),
    qa_script_adherence_score: qaScore(value.qa_script_adherence_score),
    qa_summary: typeof value.qa_summary === 'string' ? value.qa_summary.trim().slice(0, 1500) : null,
    qa_findings: Array.isArray(value.qa_findings) ? value.qa_findings.filter((x): x is string => typeof x === 'string').slice(0, 5) : [],
  }
}

export async function POST(request: Request) {
  const secret = process.env.AI_ANALYSIS_WORKER_SECRET
  if (!secret || request.headers.get('x-ai-worker-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const db = supabaseAdmin()
  const { data: jobs, error } = await db.from('ai_analysis_jobs').select('id, account_id, conversation_id').eq('status', 'queued').lte('scheduled_at', new Date().toISOString()).order('scheduled_at').limit(5)
  if (error) return NextResponse.json({ error: 'Could not load jobs' }, { status: 500 })
  let completed = 0; let skipped = 0; let failed = 0
  for (const job of (jobs ?? []) as Job[]) {
    const { data: claimed } = await db.from('ai_analysis_jobs').update({ status: 'processing', attempts: 1 }).eq('id', job.id).eq('status', 'queued').select('id').maybeSingle()
    if (!claimed) continue
    try {
      const config = await loadAiConfig(db, job.account_id)
      if (!config) throw new Error('La IA no está activa.')
      const [daily, monthly, perConversation] = await Promise.all([
        db.from('ai_usage_log').select('id', { count: 'exact', head: true }).eq('account_id', job.account_id).eq('mode', 'analysis').gte('created_at', startOfDay()),
        db.from('ai_usage_log').select('id', { count: 'exact', head: true }).eq('account_id', job.account_id).eq('mode', 'analysis').gte('created_at', startOfMonth()),
        db.from('ai_usage_log').select('id', { count: 'exact', head: true }).eq('conversation_id', job.conversation_id).eq('mode', 'analysis'),
      ])
      const { data: policy } = await db.from('ai_configs').select('analysis_daily_limit, analysis_monthly_limit, analysis_max_per_conversation, qa_scoring_enabled, qa_scoring_criteria').eq('account_id', job.account_id).single()
      if (!policy || (daily.count ?? 0) >= policy.analysis_daily_limit || (monthly.count ?? 0) >= policy.analysis_monthly_limit || (perConversation.count ?? 0) >= policy.analysis_max_per_conversation) {
        await db.from('ai_analysis_jobs').update({ status: 'skipped_limit', error_message: 'Límite de análisis alcanzado.' }).eq('id', job.id); skipped++; continue
      }
      const messages = await buildConversationContext(db, job.conversation_id)
      if (!messages.length) throw new Error('No hay mensajes de texto.')
      const qaPrompt = policy.qa_scoring_enabled
        ? ' Incluye además QA interno: "qa_score":0-100, "qa_empathy_score":0-100, "qa_objection_handling_score":0-100, "qa_script_adherence_score":0-100, "qa_summary":"...", "qa_findings":["..."]. Evalúa solo lo observable; si no hubo objeciones o guion aplicable, indícalo y usa una puntuación neutral. ' + (policy.qa_scoring_criteria ? `Criterios propios: ${policy.qa_scoring_criteria}` : '')
        : ''
      const result = await generateText({ config, messages, systemPrompt: 'Analiza la conversación. Responde únicamente JSON: {"summary":"...","sentiment":"positive|neutral|negative|mixed","sentiment_score":0,"next_best_action":"...","reasons":["..."]}. Usa español y no inventes datos.' + qaPrompt })
      const analysis = parse(result.text)
      const { error: writeError } = await db.from('ai_conversation_analyses').upsert({ account_id: job.account_id, conversation_id: job.conversation_id, source: 'whatsapp', status: 'completed', ...analysis, model: config.model, analyzed_message_count: messages.length, analyzed_at: new Date().toISOString(), error_message: null }, { onConflict: 'conversation_id,source' })
      if (writeError) throw writeError
      await db.from('ai_analysis_jobs').update({ status: 'completed', error_message: null }).eq('id', job.id)
      await logAiUsage(db, { accountId: job.account_id, conversationId: job.conversation_id, mode: 'analysis', provider: config.provider, model: config.model, usage: result.usage })
      completed++
    } catch (cause) {
      await db.from('ai_analysis_jobs').update({ status: 'failed', error_message: cause instanceof Error ? cause.message.slice(0, 500) : 'Error desconocido' }).eq('id', job.id)
      failed++
    }
  }
  return NextResponse.json({ completed, skipped, failed })
}
