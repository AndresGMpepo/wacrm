import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAiResult, fetchCdrDetail, type JsonRecord } from './yeastar-ai'
import { analyzeCall } from './call-summary'
import { callCustomerPhone } from './call-party'
import { applyContactMemory } from '@/lib/ai/memory'
import { resolveAuditUserId } from '@/lib/api/v1/contacts'
import { findOrCreateContactByPhone } from '@/lib/whatsapp/resolve-conversation'
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils'

type SyncRow = {
  id: string; account_id: string; call_id: string; contact_id: string | null
  customer_phone: string | null; transcript: string | null; summary: string | null
  started_at: string | null; created_at: string; yeastar_payload: JsonRecord | null
}

export async function processCallTranscriptions(db: SupabaseClient) {
  const now = new Date().toISOString()
  const leaseExpired = new Date(Date.now() - 10 * 60_000).toISOString()
  const { data: rows, error } = await db.from('yeastar_call_transcriptions')
    .select('id, account_id, call_id, contact_id, customer_phone, transcript, summary, started_at, created_at, yeastar_payload')
    .or('transcription_status.in.(pending,failed),and(transcription_status.eq.completed,analysis_status.in.(pending,failed))')
    .or(`sync_claimed_at.is.null,sync_claimed_at.lt.${leaseExpired}`)
    .lte('next_sync_at', now).order('next_sync_at').limit(3)
  if (error) throw error
  const counts = { completed: 0, pending: 0, failed: 0, unavailable: 0 }
  await Promise.all((rows as SyncRow[] ?? []).map(async (row) => {
    const { data: claim, error: claimError } = await db.from('yeastar_call_transcriptions')
      .update({ sync_claimed_at: now }).eq('id', row.id).eq('account_id', row.account_id)
      .or(`sync_claimed_at.is.null,sync_claimed_at.lt.${leaseExpired}`).select('id').maybeSingle()
    if (claimError) throw claimError
    if (!claim) return
    const update = async (patch: JsonRecord) => {
      const { error: writeError } = await db.from('yeastar_call_transcriptions').update({
        ...patch, sync_claimed_at: null, updated_at: new Date().toISOString(),
        next_sync_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      }).eq('id', row.id).eq('account_id', row.account_id)
      if (writeError) throw writeError
    }
    const event = (row.yeastar_payload?.event ?? row.yeastar_payload ?? {}) as JsonRecord
    let transcript = row.transcript
    try {
      if (!transcript) {
        const ai = await fetchAiResult(db, row.account_id, row.call_id, event)
        if (!ai.transcript) {
          const expired = Date.now() - new Date(row.created_at).getTime() > 72 * 60 * 60_000
          await update({
            transcription_status: expired ? 'unavailable' : 'pending',
            analysis_status: expired ? 'unavailable' : 'pending',
            error_message: ai.contextError ?? (expired ? 'Yeastar no publicó una transcripción; usa Sincronizar desde Yeastar para recuperarla después.' : null),
          })
          counts[expired ? 'unavailable' : 'pending']++
          return
        }
        transcript = ai.transcript
        const { error: transcriptError } = await db.from('yeastar_call_transcriptions').update({
          cdr_id: ai.cdrId, transcript, transcription_status: 'completed', error_message: null,
          yeastar_payload: { event, ai: ai.raw },
        }).eq('id', row.id).eq('account_id', row.account_id)
        if (transcriptError) throw transcriptError
      }
      const uid = typeof event.uid === 'string' ? event.uid : null
      if (uid) {
        const detail = await fetchCdrDetail(db, row.account_id, uid)
        if (detail) {
          const { error: detailError } = await db.from('yeastar_call_transcriptions').update({
            duration_seconds: detail.callDurationSeconds, routing_duration_seconds: detail.routingDurationSeconds,
            handling_duration_seconds: detail.handlingDurationSeconds, ring_duration_seconds: detail.ringDurationSeconds,
            hold_duration_seconds: detail.holdDurationSeconds, talk_duration_seconds: detail.talkDurationSeconds,
            disconnected_by: detail.disconnectedBy, timeline: detail.timeline,
          }).eq('id', row.id).eq('account_id', row.account_id)
          if (detailError) throw detailError
        }
      }
      let contactId = row.contact_id
      const direction = String(event.type ?? event.call_type ?? '').toLowerCase()
      const extensionNumber = direction === 'inbound' ? event.call_to : direction === 'outbound' ? event.call_from : null
      if (typeof extensionNumber === 'string') {
        const { data: agent, error: agentError } = await db.from('telephony_user_configs').select('user_id, extension')
          .eq('account_id', row.account_id).eq('provider', 'yeastar').eq('extension', extensionNumber).maybeSingle()
        if (agentError) throw agentError
        if (agent) {
          const { error: agentWriteError } = await db.from('yeastar_call_transcriptions')
            .update({ agent_user_id: agent.user_id, agent_extension: agent.extension })
            .eq('id', row.id).eq('account_id', row.account_id)
          if (agentWriteError) throw agentWriteError
        }
      }
      const phone = sanitizePhoneForMeta(callCustomerPhone(event) ?? row.customer_phone ?? '')
      if (!contactId && isValidE164(phone)) {
        const ownerId = await resolveAuditUserId(db, row.account_id)
        contactId = (await findOrCreateContactByPhone(db, row.account_id, phone, null, ownerId)).contactId
        const { error: linkError } = await db.from('yeastar_call_transcriptions')
          .update({ contact_id: contactId, customer_phone: phone }).eq('id', row.id).eq('account_id', row.account_id)
        if (linkError) throw linkError
      }
      const analysis = await analyzeCall(db, row.account_id, transcript, row.started_at ?? row.created_at)
      if (!analysis) {
        await update({ analysis_status: 'unavailable', analysis_error: 'Configura la IA de la cuenta para generar el resumen y actualizar Nexo Memory.' })
        counts.unavailable++
        return
      }
      const { error: analysisError } = await db.from('yeastar_call_transcriptions').update({
        summary: analysis.summary, key_points: analysis.key_points, action_items: analysis.action_items,
      }).eq('id', row.id).eq('account_id', row.account_id)
      if (analysisError) throw analysisError
      if (contactId) {
        await applyContactMemory(db, {
          accountId: row.account_id, contactId, source: { type: 'call', id: row.id },
          sourceDate: row.started_at ?? row.created_at,
        }, analysis, analysis.memory)
      }
      await update({
        analysis_status: 'completed', analysis_error: contactId ? null : 'No hay un teléfono externo válido para vincular esta llamada a Nexo Memory.',
        memory_applied_at: contactId ? new Date().toISOString() : null,
      })
      counts.completed++
    } catch (reason) {
      console.error('[yeastar] transcription/memory sync failed:', reason)
      await update({
        ...(transcript ? { analysis_status: 'failed', analysis_error: reason instanceof Error ? reason.message.slice(0, 500) : 'No se pudo actualizar el contexto de la llamada.' }
          : { transcription_status: 'failed', error_message: reason instanceof Error ? reason.message.slice(0, 500) : 'No se pudo recuperar la transcripción.' }),
      })
      counts.failed++
    }
  }))
  return counts
}
