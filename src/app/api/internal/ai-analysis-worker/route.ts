import { NextResponse } from 'next/server'
import { loadAiConfig } from '@/lib/ai/config'
import { buildConversationContext } from '@/lib/ai/context'
import { generateText } from '@/lib/ai/generate'
import { logAiUsage } from '@/lib/ai/usage'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { downloadMedia, getMediaUrl } from '@/lib/whatsapp/meta-api'
import { describeImageWithOpenAi, transcribeAudioWithOpenAi } from '@/lib/ai/media-analysis'
import { aiRequestTimeoutMs } from '@/lib/ai/defaults'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'

export const maxDuration = 60

type Job = { id: string; account_id: string; conversation_id: string }
type MediaJob = Job & { message_id: string; kind: 'image' | 'voice_note' }

function startOfDay() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString() }
function startOfMonth() { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.toISOString() }

function chatMediaStoragePath(mediaUrl: string | null | undefined) {
  if (!mediaUrl) return null
  try {
    const publicUrl = new URL(mediaUrl)
    const supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!)
    const prefix = '/storage/v1/object/public/chat-media/'
    if (publicUrl.origin !== supabaseUrl.origin || !publicUrl.pathname.startsWith(prefix)) return null
    const path = publicUrl.pathname.slice(prefix.length).split('/').map(decodeURIComponent).join('/')
    return path && !path.split('/').some((segment) => segment === '.' || segment === '..') ? path : null
  } catch {
    return null
  }
}

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
      const dailyCount = daily.count ?? 0
      const monthlyCount = monthly.count ?? 0
      const conversationCount = perConversation.count ?? 0
      if (!policy) {
        await db.from('ai_analysis_jobs').update({ status: 'skipped_limit', error_message: 'No hay una política de análisis configurada para esta cuenta.' }).eq('id', job.id); skipped++; continue
      }
      const limitReason = dailyCount >= policy.analysis_daily_limit
        ? `Límite diario alcanzado (${dailyCount}/${policy.analysis_daily_limit}).`
        : monthlyCount >= policy.analysis_monthly_limit
          ? `Límite mensual alcanzado (${monthlyCount}/${policy.analysis_monthly_limit}).`
          : conversationCount >= policy.analysis_max_per_conversation
            ? `Máximo por conversación alcanzado (${conversationCount}/${policy.analysis_max_per_conversation}).`
            : null
      if (limitReason) {
        await db.from('ai_analysis_jobs').update({ status: 'skipped_limit', error_message: limitReason }).eq('id', job.id); skipped++; continue
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
      // Keep outbound automation useful but privacy-preserving: n8n receives
      // analysis metadata, never the transcript, customer identifiers, media,
      // summary or the model's private reasoning.
      const eventData = {
        conversation_id: job.conversation_id,
        sentiment: analysis.sentiment,
        sentiment_score: analysis.sentiment_score,
        qa_score: analysis.qa_score,
        next_best_action: analysis.next_best_action,
        analyzed_at: new Date().toISOString(),
      }
      await dispatchWebhookEvent(db, job.account_id, 'ai.analysis.completed', eventData)
      if (analysis.sentiment === 'negative') {
        await dispatchWebhookEvent(db, job.account_id, 'ai.critical_detected', eventData)
      }
      completed++
    } catch (cause) {
      await db.from('ai_analysis_jobs').update({ status: 'failed', error_message: cause instanceof Error ? cause.message.slice(0, 500) : 'Error desconocido' }).eq('id', job.id)
      failed++
    }
  }
  const mediaResult = await processMediaJobs(db)
  const followUps = await processCallFollowUps(db)
  return NextResponse.json({ completed, skipped, failed, media: mediaResult, follow_ups: followUps })
}

async function processCallFollowUps(db: ReturnType<typeof supabaseAdmin>) {
  const { data: policies, error } = await db.from('call_follow_up_policies').select('account_id, no_reply_minutes').eq('enabled', true).limit(25)
  if (error) return { created: 0, eligible: 0, duplicates: 0, failed: 1 }
  let created = 0
  let eligible = 0
  let duplicates = 0
  let failed = 0
  for (const policy of policies ?? []) {
    const cutoff = new Date(Date.now() - Number(policy.no_reply_minutes) * 60_000).toISOString()
    const { data: conversations } = await db.from('conversations').select('id, assigned_agent_id').eq('account_id', policy.account_id).eq('status', 'open').order('updated_at', { ascending: true }).limit(50)
    for (const conversation of conversations ?? []) {
      const { data: last } = await db.from('messages').select('sender_type, created_at').eq('conversation_id', conversation.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (!last || last.sender_type === 'customer' || last.created_at > cutoff) continue
      eligible++
      const { error: insertError } = await db.from('call_follow_up_tasks').insert({ account_id: policy.account_id, conversation_id: conversation.id, assigned_agent_id: conversation.assigned_agent_id, due_at: new Date().toISOString(), source: 'no_reply' })
      if (!insertError) {
        created++
      } else if (insertError.code === '23505') {
        duplicates++
      } else {
        failed++
        console.error('[follow-ups] Could not create task', { accountId: policy.account_id, conversationId: conversation.id, error: insertError.message })
      }
      // The partial unique index intentionally turns a duplicate pending task
      // into a harmless no-op on later worker passes.
    }
  }
  return { created, eligible, duplicates, failed }
}

async function processMediaJobs(db: ReturnType<typeof supabaseAdmin>) {
  const { data: jobs, error } = await db
    .from('ai_media_analysis_jobs')
    .select('id, account_id, conversation_id, message_id, kind')
    .eq('status', 'queued')
    .order('created_at')
    .limit(3)
  if (error) return { completed: 0, skipped: 0, failed: 0 }

  let completed = 0; let skipped = 0; let failed = 0
  for (const job of (jobs ?? []) as MediaJob[]) {
    const { data: claimed } = await db.from('ai_media_analysis_jobs')
      .update({ status: 'processing', attempts: 1, error_message: null })
      .eq('id', job.id).eq('status', 'queued').select('id').maybeSingle()
    if (!claimed) continue

    try {
      const config = await loadAiConfig(db, job.account_id)
      if (!config) throw new Error('La IA no está activa.')
      if (config.provider !== 'openai') {
        await finishMediaJob(db, job, 'skipped_unsupported', 'El análisis de medios requiere OpenAI.', 'skipped')
        skipped++; continue
      }
      const { data: policy } = await db.from('ai_configs')
        .select('media_analysis_daily_limit')
        .eq('account_id', job.account_id).single()
      const { count } = await db.from('ai_media_analysis_jobs').select('id', { count: 'exact', head: true })
        .eq('account_id', job.account_id).eq('status', 'completed').gte('created_at', startOfDay())
      if (!policy || (count ?? 0) >= policy.media_analysis_daily_limit) {
        await finishMediaJob(db, job, 'skipped_limit', 'Límite diario de análisis de medios alcanzado.', 'skipped')
        skipped++; continue
      }
      const { data: message } = await db.from('messages').select('id, media_url, sender_type')
        .eq('id', job.message_id).eq('conversation_id', job.conversation_id).maybeSingle()
      const match = typeof message?.media_url === 'string' ? message.media_url.match(/^\/api\/whatsapp\/media\/([^/?#]+)$/) : null
      const storagePath = chatMediaStoragePath(message?.media_url)
      if (!message || message.sender_type !== 'customer' || (!match?.[1] && !storagePath)) {
        await finishMediaJob(db, job, 'skipped_unsupported', 'El medio ya no está disponible para análisis.', 'skipped')
        skipped++; continue
      }
      if (storagePath) {
        const { data: blob, error: storageError } = await db.storage.from('chat-media').download(storagePath)
        if (storageError || !blob) throw storageError ?? new Error('No se pudo recuperar la imagen guardada.')
        const bytes = Buffer.from(await blob.arrayBuffer())
        const mimeType = blob.type || (job.kind === 'image' ? 'image/jpeg' : 'audio/ogg')
        const value = job.kind === 'image'
          ? await describeImageWithOpenAi({ apiKey: config.apiKey, bytes, mimeType, timeoutMs: aiRequestTimeoutMs() })
          : await transcribeAudioWithOpenAi({ apiKey: config.apiKey, bytes, mimeType, timeoutMs: aiRequestTimeoutMs() })
        const messagePatch = job.kind === 'image'
          ? { media_analysis_status: 'completed', media_description: value, media_transcript: null, media_analyzed_at: new Date().toISOString(), media_analysis_error: null }
          : { media_analysis_status: 'completed', media_transcript: value, media_description: null, media_analyzed_at: new Date().toISOString(), media_analysis_error: null }
        const { error: messageError } = await db.from('messages').update(messagePatch).eq('id', job.message_id)
        if (messageError) throw messageError
        await db.from('ai_media_analysis_jobs').update({ status: 'completed', error_message: null }).eq('id', job.id)
        await db.rpc('queue_ai_analysis_job', { p_account_id: job.account_id, p_conversation_id: job.conversation_id, p_trigger: 'manual', p_delay: '0 minutes' })
        completed++; continue
      }
      const { data: whatsapp } = await db.from('whatsapp_config').select('access_token').eq('account_id', job.account_id).maybeSingle()
      if (!whatsapp?.access_token) throw new Error('WhatsApp no está configurado para recuperar el medio.')
      const token = decrypt(whatsapp.access_token)
      const media = await getMediaUrl({ mediaId: match![1], accessToken: token })
      const downloaded = await downloadMedia({ downloadUrl: media.url, accessToken: token })
      const mimeType = downloaded.contentType || media.mimeType
      const value = job.kind === 'image'
        ? await describeImageWithOpenAi({ apiKey: config.apiKey, bytes: downloaded.buffer, mimeType, timeoutMs: aiRequestTimeoutMs() })
        : await transcribeAudioWithOpenAi({ apiKey: config.apiKey, bytes: downloaded.buffer, mimeType, timeoutMs: aiRequestTimeoutMs() })
      const messagePatch = job.kind === 'image'
        ? { media_analysis_status: 'completed', media_description: value, media_transcript: null, media_analyzed_at: new Date().toISOString(), media_analysis_error: null }
        : { media_analysis_status: 'completed', media_transcript: value, media_description: null, media_analyzed_at: new Date().toISOString(), media_analysis_error: null }
      const { error: messageError } = await db.from('messages').update(messagePatch).eq('id', job.message_id)
      if (messageError) throw messageError
      await db.from('ai_media_analysis_jobs').update({ status: 'completed', error_message: null }).eq('id', job.id)
      // Refresh the conversation intelligence from the safely-derived text,
      // never from the original binary attachment.
      await db.rpc('queue_ai_analysis_job', { p_account_id: job.account_id, p_conversation_id: job.conversation_id, p_trigger: 'manual', p_delay: '0 minutes' })
      completed++
    } catch (cause) {
      const message = cause instanceof Error ? cause.message.slice(0, 500) : 'Error desconocido'
      await db.from('ai_media_analysis_jobs').update({ status: 'failed', error_message: message }).eq('id', job.id)
      await db.from('messages').update({ media_analysis_status: 'failed', media_analysis_error: message }).eq('id', job.message_id)
      failed++
    }
  }
  return { completed, skipped, failed }
}

async function finishMediaJob(
  db: ReturnType<typeof supabaseAdmin>,
  job: MediaJob,
  status: 'skipped_limit' | 'skipped_unsupported',
  error: string,
  messageStatus: 'skipped',
) {
  await db.from('ai_media_analysis_jobs').update({ status, error_message: error }).eq('id', job.id)
  await db.from('messages').update({ media_analysis_status: messageStatus, media_analysis_error: error }).eq('id', job.message_id)
}
