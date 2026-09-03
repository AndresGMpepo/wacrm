import { NextResponse } from 'next/server'
import { loadAiConfig } from '@/lib/ai/config'
import { buildConversationContext } from '@/lib/ai/context'
import { generateText } from '@/lib/ai/generate'
import { logAiUsage } from '@/lib/ai/usage'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { downloadMedia, getMediaUrl } from '@/lib/whatsapp/meta-api'
import { downloadZernioInboundMedia, type ZernioChannel } from '@/lib/zernio/server'
import { describeImageWithOpenAi, downloadPublicMedia, transcribeAudioWithOpenAi } from '@/lib/ai/media-analysis'
import { MIN_DAILY_ANALYSES_PER_CONVERSATION, aiRequestTimeoutMs } from '@/lib/ai/defaults'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { syncGoogleCalendarChanges } from '@/lib/appointments/google-calendar'
import { flowChannel, flowSendText } from '@/lib/flows/channel-send'
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
import { alertCommitmentOverdue, alertStaleProspect, sendDailyNexoMemoryDigest } from '@/lib/notifications/nexo-memory-alerts'

export const maxDuration = 60

type Job = { id: string; account_id: string; conversation_id: string; attempts: number; conversation: { contact_id: string } | { contact_id: string }[] | null }
type MediaJob = { id: string; account_id: string; conversation_id: string; message_id: string; kind: 'image' | 'voice_note'; conversation: { channel_type: string | null } | { channel_type: string | null }[] | null }
type AppointmentReminderJob = {
  id: string
  account_id: string
  appointment: {
    id: string
    contact_id: string | null
    created_by: string | null
    source_conversation_id: string | null
    starts_at: string
    timezone: string
    title: string
    status: string
  } | {
    id: string
    contact_id: string | null
    created_by: string | null
    source_conversation_id: string | null
    starts_at: string
    timezone: string
    title: string
    status: string
  }[] | null
}

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

function parse(value: Record<string, unknown>) {
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
  // Media (image/voice-note) analysis runs first so any job that completes
  // within this same tick is already reflected in `messages` before the
  // conversation-analysis loop below builds its context — reduces the
  // "analyzed before the transcript existed" window from a full cron cycle
  // to zero when both finish in the same pass.
  const mediaResult = await processMediaJobs(db)
  const { data: jobs, error } = await db.from('ai_analysis_jobs').select('id, account_id, conversation_id, attempts, conversation:conversations(contact_id)').eq('status', 'queued').lte('scheduled_at', new Date().toISOString()).order('scheduled_at').limit(5)
  if (error) return NextResponse.json({ error: 'Could not load jobs' }, { status: 500 })
  let completed = 0; let skipped = 0; let failed = 0
  for (const job of (jobs ?? []) as Job[]) {
    const { data: claimed } = await db.from('ai_analysis_jobs').update({ status: 'processing', attempts: 1 }).eq('id', job.id).eq('status', 'queued').select('id').maybeSingle()
    if (!claimed) continue
    // Don't lock in an analysis built on incomplete context: if this
    // conversation has a customer image/voice note still being described/
    // transcribed, push the job back a few minutes instead of analyzing
    // text-only — the media job's own completion re-queues analysis anyway
    // (see processMediaJobs), so this just avoids a wrong summary being
    // shown to agents in the meantime. Capped attempts so a media job that
    // never finishes (stuck/failed) doesn't stall analysis forever.
    const pendingMediaAttemptsCap = 4
    if (job.attempts < pendingMediaAttemptsCap) {
      const { count: pendingMediaCount } = await db.from('messages').select('id', { count: 'exact', head: true })
        .eq('conversation_id', job.conversation_id).eq('sender_type', 'customer').not('media_url', 'is', null)
        .in('media_analysis_status', ['queued', 'processing'])
      if ((pendingMediaCount ?? 0) > 0) {
        await db.from('ai_analysis_jobs').update({ status: 'queued', scheduled_at: new Date(Date.now() + 2 * 60_000).toISOString(), attempts: job.attempts + 1 }).eq('id', job.id)
        skipped++; continue
      }
    }
    try {
      const config = await loadAiConfig(db, job.account_id)
      if (!config) throw new Error('La IA no está activa.')
      const [daily, monthly, perConversation] = await Promise.all([
        db.from('ai_usage_log').select('id', { count: 'exact', head: true }).eq('account_id', job.account_id).eq('mode', 'analysis').gte('created_at', startOfDay()),
        db.from('ai_usage_log').select('id', { count: 'exact', head: true }).eq('account_id', job.account_id).eq('mode', 'analysis').gte('created_at', startOfMonth()),
        db.from('ai_usage_log').select('id', { count: 'exact', head: true }).eq('conversation_id', job.conversation_id).eq('mode', 'analysis').gte('created_at', startOfDay()),
      ])
      const { data: policy } = await db.from('ai_configs').select('analysis_daily_limit, analysis_monthly_limit, analysis_max_per_conversation, qa_scoring_enabled, qa_scoring_criteria, analysis_auto_route_enabled').eq('account_id', job.account_id).single()
      const dailyCount = daily.count ?? 0
      const monthlyCount = monthly.count ?? 0
      const conversationCount = perConversation.count ?? 0
      if (!policy) {
        await db.from('ai_analysis_jobs').update({ status: 'skipped_limit', error_message: 'No hay una política de análisis configurada para esta cuenta.' }).eq('id', job.id); skipped++; continue
      }
      const conversationLimit = Math.max(
        MIN_DAILY_ANALYSES_PER_CONVERSATION,
        Number(policy.analysis_max_per_conversation) || MIN_DAILY_ANALYSES_PER_CONVERSATION,
      )
      const limitReason = dailyCount >= policy.analysis_daily_limit
        ? `Límite diario alcanzado (${dailyCount}/${policy.analysis_daily_limit}).`
        : monthlyCount >= policy.analysis_monthly_limit
          ? `Límite mensual alcanzado (${monthlyCount}/${policy.analysis_monthly_limit}).`
          : conversationCount >= conversationLimit
            ? `El límite diario de análisis para esta conversación fue alcanzado (${Math.min(conversationCount, conversationLimit)}/${conversationLimit}).`
            : null
      if (limitReason) {
        await db.from('ai_analysis_jobs').update({ status: 'skipped_limit', error_message: limitReason }).eq('id', job.id); skipped++; continue
      }
      const messages = await buildConversationContext(db, job.conversation_id)
      if (!messages.length) throw new Error('No hay mensajes de texto.')
      const qaPrompt = policy.qa_scoring_enabled
        ? ' Incluye además QA interno: "qa_score":0-100, "qa_empathy_score":0-100, "qa_objection_handling_score":0-100, "qa_script_adherence_score":0-100, "qa_summary":"...", "qa_findings":["..."]. Evalúa solo lo observable; si no hubo objeciones o guion aplicable, indícalo y usa una puntuación neutral. ' + (policy.qa_scoring_criteria ? `Criterios propios: ${policy.qa_scoring_criteria}` : '')
        : ''
      const memoryPrompt = ' Incluye también memoria del cliente (Nexo Memory): "customer_stage":"..." (p.ej. prospecto, cotización, propuesta, cliente), "risk_level":"low|medium|high", "opportunity_score":0-100, "interests":[{"text":"...","confidence":0-1}], "objections":[{"text":"...","confidence":0-1}], "commitments":[{"description":"...","owner":"agent|customer","due_date":"YYYY-MM-DD|null"}], "important_facts":["..."] (hechos nuevos y relevantes, no saludos ni trivialidades). Omite cualquier campo del que no tengas evidencia clara en la conversación.'
      const analysisConfig = { ...config, model: config.analysisModel ?? config.model }
      const queues = await loadAccountQueues(db, job.account_id)
      const result = await generateText({ config: analysisConfig, messages, systemPrompt: 'Analiza la conversación. Responde únicamente JSON: {"summary":"...","sentiment":"positive|neutral|negative|mixed","sentiment_score":0,"next_best_action":"...","reasons":["..."]}. Usa español y no inventes datos.' + qaPrompt + memoryPrompt + INSIGHTS_PROMPT + departmentsPrompt(queues.map((q) => q.name)) })
      const match = result.text.match(/\{[\s\S]*\}/)
      if (!match) throw new Error('La IA no devolvió JSON válido.')
      const rawValue = JSON.parse(match[0]) as Record<string, unknown>
      const analysis = parse(rawValue)
      const insights = parseConversationInsights(rawValue)
      const recommendedQueueId = matchDepartmentQueue(queues, insights.recommended_department)
      const { error: writeError } = await db.from('ai_conversation_analyses').upsert({
        account_id: job.account_id,
        conversation_id: job.conversation_id,
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
      if (writeError) throw writeError
      const contactId = Array.isArray(job.conversation) ? job.conversation[0]?.contact_id : job.conversation?.contact_id
      if (contactId) {
        const memory = parseMemoryExtraction(rawValue)
        // `customer_context_update` is what the model learned that we didn't
        // already know, which is exactly the shape Nexo Memory wants.
        memory.important_facts = [...memory.important_facts, ...insights.customer_context_update].slice(0, 8)
        await applyContactMemory(db, { accountId: job.account_id, contactId, source: { type: 'conversation', id: job.conversation_id } }, analysis, memory).catch((memoryError) => {
          console.error('[nexo-memory] Failed to apply memory extraction:', memoryError)
        })
        await enrichContactFromInsights(db, job.account_id, contactId, insights)
      }
      if (policy.analysis_auto_route_enabled && insights.handoff_required && recommendedQueueId) {
        await routeConversationToQueue(db, job.account_id, job.conversation_id, recommendedQueueId)
      }
      await db.from('ai_analysis_jobs').update({ status: 'completed', error_message: null }).eq('id', job.id)
      await logAiUsage(db, { accountId: job.account_id, conversationId: job.conversation_id, mode: 'analysis', provider: config.provider, model: analysisConfig.model, usage: result.usage })
      // Keep outbound automation useful but privacy-preserving: n8n receives
      // analysis metadata, never the transcript, customer identifiers, media,
      // summary or the model's private reasoning.
      const eventData = {
        conversation_id: job.conversation_id,
        sentiment: analysis.sentiment,
        sentiment_score: analysis.sentiment_score,
        qa_score: analysis.qa_score,
        next_best_action: analysis.next_best_action,
        intent: insights.intent,
        sub_intent: insights.sub_intent,
        urgency: insights.urgency,
        lead_temperature: insights.lead_temperature,
        commercial_opportunity: insights.commercial_opportunity,
        handoff_required: insights.handoff_required,
        recommended_department: insights.recommended_department,
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
  const followUps = await processCallFollowUps(db)
  const appointmentReminders = await processAppointmentReminders(db)
  const overdueCommitments = await markOverdueCommitments(db)
  const staleProspects = await alertStaleProspects(db)
  await sendNexoMemoryDigests(db).catch((error) => {
    console.error('[nexo-memory] Failed to send daily digests:', error)
  })
  let googleCalendar: Awaited<ReturnType<typeof syncGoogleCalendarChanges>> | null = null
  try {
    googleCalendar = await syncGoogleCalendarChanges()
  } catch (error) {
    console.error('[appointments] Google Calendar inbound sync could not start:', error)
  }
  return NextResponse.json({ completed, skipped, failed, media: mediaResult, follow_ups: followUps, appointment_reminders: appointmentReminders, overdue_commitments: overdueCommitments, stale_prospects: staleProspects, google_calendar: googleCalendar })
}

async function processAppointmentReminders(db: ReturnType<typeof supabaseAdmin>) {
  const { data, error } = await db
    .from('appointment_reminders')
    .select('id, account_id, appointment:appointments(id, contact_id, created_by, source_conversation_id, starts_at, timezone, title, status)')
    .eq('status', 'queued')
    .lte('due_at', new Date().toISOString())
    .order('due_at')
    .limit(20)
  if (error) {
    console.error('[appointments] Could not load reminders:', error.message)
    return { sent: 0, skipped: 0, failed: 1 }
  }

  let sent = 0
  let skipped = 0
  let failed = 0
  for (const reminder of (data ?? []) as AppointmentReminderJob[]) {
    const { data: claimed } = await db.from('appointment_reminders')
      .update({ status: 'sending', error_message: null })
      .eq('id', reminder.id)
      .eq('status', 'queued')
      .select('id')
      .maybeSingle()
    if (!claimed) continue

    const appointment = Array.isArray(reminder.appointment)
      ? reminder.appointment[0]
      : reminder.appointment
    if (!appointment || ['cancelled', 'completed', 'no_show'].includes(appointment.status)) {
      await db.from('appointment_reminders').update({ status: 'skipped', error_message: 'La cita ya no está pendiente.' }).eq('id', reminder.id)
      skipped++
      continue
    }
    if (!appointment.contact_id || !appointment.created_by || !appointment.source_conversation_id) {
      await db.from('appointment_reminders').update({ status: 'skipped', error_message: 'La cita no tiene una conversación de origen para conservar el canal.' }).eq('id', reminder.id)
      skipped++
      continue
    }

    if (await flowChannel(reminder.account_id, appointment.source_conversation_id) === 'whatsapp') {
      const { data: lastInbound } = await db.from('messages')
        .select('created_at')
        .eq('conversation_id', appointment.source_conversation_id)
        .eq('sender_type', 'customer')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const isWithinWindow = lastInbound && Date.now() - new Date(lastInbound.created_at).getTime() <= 24 * 60 * 60_000
      if (!isWithinWindow) {
        await db.from('appointment_reminders').update({ status: 'skipped', error_message: 'WhatsApp requiere una plantilla aprobada después de 24 horas sin respuesta del cliente.' }).eq('id', reminder.id)
        skipped++
        continue
      }
    }

    const startsAt = new Intl.DateTimeFormat('es-MX', {
      timeZone: appointment.timezone || 'UTC',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(appointment.starts_at))
    try {
      await flowSendText({
        accountId: reminder.account_id,
        userId: appointment.created_by,
        conversationId: appointment.source_conversation_id,
        contactId: appointment.contact_id,
        text: `Recordatorio: tienes ${appointment.title} el ${startsAt}.`,
      })
      await db.from('appointment_reminders').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', reminder.id)
      sent++
    } catch (cause) {
      const message = cause instanceof Error ? cause.message.slice(0, 500) : 'No se pudo enviar el recordatorio.'
      await db.from('appointment_reminders').update({ status: 'failed', error_message: message }).eq('id', reminder.id)
      console.error('[appointments] Could not send reminder:', { appointmentId: appointment.id, error: message })
      failed++
    }
  }
  return { sent, skipped, failed }
}

/** A commitment ("enviar cotización el viernes") that's still 'pending' past its
 *  due date is a broken promise — flag it automatically so Nexo Memory and the
 *  executive action queue surface it without waiting for the next AI analysis. */
async function markOverdueCommitments(db: ReturnType<typeof supabaseAdmin>) {  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await db.from('contact_commitments')
    .update({ status: 'overdue', updated_at: new Date().toISOString() })
    .eq('status', 'pending')
    .lt('due_date', today)
    .select('id, account_id, contact_id, description')
  if (error) {
    console.error('[nexo-memory] Failed to mark overdue commitments:', error)
    return { marked: 0 }
  }
  for (const commitment of data ?? []) {
    await alertCommitmentOverdue(db, commitment.account_id, commitment.contact_id, commitment.description).catch((alertError) => {
      console.error('[nexo-memory] Failed to send overdue-commitment alert:', alertError)
    })
  }
  return { marked: data?.length ?? 0 }
}

/** A prospect (medium/high risk, i.e. still an open relationship) whose
 *  memory hasn't been touched in 48h gets flagged — and re-flagged every 48h
 *  while it stays stale, via stale_alerted_at. */
async function alertStaleProspects(db: ReturnType<typeof supabaseAdmin>) {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const { data, error } = await db.from('contact_memory')
    .select('account_id, contact_id')
    .in('risk_level', ['medium', 'high'])
    .lt('updated_at', cutoff)
    .or(`stale_alerted_at.is.null,stale_alerted_at.lt.${cutoff}`)
    .limit(50)
  if (error) {
    console.error('[nexo-memory] Failed to load stale prospects:', error)
    return { alerted: 0 }
  }
  for (const row of data ?? []) {
    await alertStaleProspect(db, row.account_id, row.contact_id).catch((alertError) => {
      console.error('[nexo-memory] Failed to send stale-prospect alert:', alertError)
    })
    await db.from('contact_memory').update({ stale_alerted_at: new Date().toISOString() }).eq('contact_id', row.contact_id)
  }
  return { alerted: data?.length ?? 0 }
}

/** One aggregate "Resumen diario de Nexo Memory" notification per account —
 *  cheap enough to check every tick since it's a handful of head-count
 *  queries per account, and sendDailyNexoMemoryDigest itself dedupes to once
 *  per calendar day. */
async function sendNexoMemoryDigests(db: ReturnType<typeof supabaseAdmin>) {
  const { data: accounts, error } = await db.from('contact_memory').select('account_id')
  if (error) throw error
  const accountIds = [...new Set((accounts ?? []).map((row) => row.account_id))]
  for (const accountId of accountIds) {
    const [overdue, highRisk, stale] = await Promise.all([
      db.from('contact_commitments').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('status', 'overdue'),
      db.from('contact_memory').select('contact_id', { count: 'exact', head: true }).eq('account_id', accountId).eq('risk_level', 'high'),
      db.from('contact_memory').select('contact_id', { count: 'exact', head: true }).eq('account_id', accountId).in('risk_level', ['medium', 'high']).lt('updated_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()),
    ])
    await sendDailyNexoMemoryDigest(db, accountId, {
      overdueCommitments: overdue.count ?? 0,
      highRisk: highRisk.count ?? 0,
      staleProspects: stale.count ?? 0,
    })
  }
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
    .select('id, account_id, conversation_id, message_id, kind, conversation:conversations(channel_type)')
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
      const conversation = Array.isArray(job.conversation) ? job.conversation[0] : job.conversation
      const channelType = conversation?.channel_type
      const zernioChannel = channelType?.startsWith('zernio_')
        ? channelType.slice('zernio_'.length) as ZernioChannel
        : null
      const directCdnChannel = zernioChannel || (channelType === 'facebook' || channelType === 'instagram' ? channelType : null)
      if (!message || message.sender_type !== 'customer' || (!match?.[1] && !storagePath && !directCdnChannel)) {
        await finishMediaJob(db, job, 'skipped_unsupported', 'El medio ya no está disponible para análisis.', 'skipped')
        skipped++; continue
      }
      if (zernioChannel && ['whatsapp', 'facebook', 'instagram'].includes(zernioChannel)) {
        const downloaded = await downloadZernioInboundMedia(message.media_url!, zernioChannel)
        const mimeType = downloaded.mimeType || (job.kind === 'image' ? 'image/jpeg' : 'audio/ogg')
        const value = job.kind === 'image'
          ? await describeImageWithOpenAi({ apiKey: config.apiKey, model: config.imageAnalysisModel ?? 'gpt-4.1-mini', bytes: downloaded.bytes, mimeType, timeoutMs: aiRequestTimeoutMs() })
          : await transcribeAudioWithOpenAi({ apiKey: config.apiKey, model: config.voiceTranscriptionModel ?? 'gpt-4o-mini-transcribe', bytes: downloaded.bytes, mimeType, timeoutMs: aiRequestTimeoutMs() })
        const messagePatch = job.kind === 'image'
          ? { media_analysis_status: 'completed', media_description: value, media_transcript: null, media_analyzed_at: new Date().toISOString(), media_analysis_error: null }
          : { media_analysis_status: 'completed', media_transcript: value, media_description: null, media_analyzed_at: new Date().toISOString(), media_analysis_error: null }
        const { error: messageError } = await db.from('messages').update(messagePatch).eq('id', job.message_id)
        if (messageError) throw messageError
        await db.from('ai_media_analysis_jobs').update({ status: 'completed', error_message: null }).eq('id', job.id)
        await db.rpc('queue_ai_analysis_job', { p_account_id: job.account_id, p_conversation_id: job.conversation_id, p_trigger: 'manual', p_delay: '0 minutes' })
        completed++; continue
      }
      if (directCdnChannel) {
        const downloaded = await downloadPublicMedia(message.media_url!)
        const mimeType = downloaded.mimeType || (job.kind === 'image' ? 'image/jpeg' : 'audio/ogg')
        const value = job.kind === 'image'
          ? await describeImageWithOpenAi({ apiKey: config.apiKey, model: config.imageAnalysisModel ?? 'gpt-4.1-mini', bytes: downloaded.bytes, mimeType, timeoutMs: aiRequestTimeoutMs() })
          : await transcribeAudioWithOpenAi({ apiKey: config.apiKey, model: config.voiceTranscriptionModel ?? 'gpt-4o-mini-transcribe', bytes: downloaded.bytes, mimeType, timeoutMs: aiRequestTimeoutMs() })
        const messagePatch = job.kind === 'image'
          ? { media_analysis_status: 'completed', media_description: value, media_transcript: null, media_analyzed_at: new Date().toISOString(), media_analysis_error: null }
          : { media_analysis_status: 'completed', media_transcript: value, media_description: null, media_analyzed_at: new Date().toISOString(), media_analysis_error: null }
        const { error: messageError } = await db.from('messages').update(messagePatch).eq('id', job.message_id)
        if (messageError) throw messageError
        await db.from('ai_media_analysis_jobs').update({ status: 'completed', error_message: null }).eq('id', job.id)
        await db.rpc('queue_ai_analysis_job', { p_account_id: job.account_id, p_conversation_id: job.conversation_id, p_trigger: 'manual', p_delay: '0 minutes' })
        completed++; continue
      }
      if (storagePath) {
        const { data: blob, error: storageError } = await db.storage.from('chat-media').download(storagePath)
        if (storageError || !blob) throw storageError ?? new Error('No se pudo recuperar la imagen guardada.')
        const bytes = Buffer.from(await blob.arrayBuffer())
        const mimeType = blob.type || (job.kind === 'image' ? 'image/jpeg' : 'audio/ogg')
        const value = job.kind === 'image'
          ? await describeImageWithOpenAi({ apiKey: config.apiKey, model: config.imageAnalysisModel ?? 'gpt-4.1-mini', bytes, mimeType, timeoutMs: aiRequestTimeoutMs() })
          : await transcribeAudioWithOpenAi({ apiKey: config.apiKey, model: config.voiceTranscriptionModel ?? 'gpt-4o-mini-transcribe', bytes, mimeType, timeoutMs: aiRequestTimeoutMs() })
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
        ? await describeImageWithOpenAi({ apiKey: config.apiKey, model: config.imageAnalysisModel ?? 'gpt-4.1-mini', bytes: downloaded.buffer, mimeType, timeoutMs: aiRequestTimeoutMs() })
        : await transcribeAudioWithOpenAi({ apiKey: config.apiKey, model: config.voiceTranscriptionModel ?? 'gpt-4o-mini-transcribe', bytes: downloaded.buffer, mimeType, timeoutMs: aiRequestTimeoutMs() })
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
