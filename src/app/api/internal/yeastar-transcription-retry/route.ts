import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { fetchAiResult, type JsonRecord } from '@/lib/telephony/yeastar-ai'
import { analyzeCall } from '@/lib/telephony/call-summary'
import { applyContactMemory } from '@/lib/ai/memory'

export const dynamic = 'force-dynamic'

// Yeastar's AI transcription/summary can take a while to finish after the
// 30012 webhook fires, so the initial sync can land with nothing to show.
// Re-attempt pending rows for a bounded window before giving up.
const RETRY_WINDOW_MS = 3 * 60 * 60 * 1000

type PendingRow = { id: string; account_id: string; call_id: string; contact_id: string | null; created_at: string; yeastar_payload: JsonRecord | null }

export async function POST(request: Request) {
  const secret = process.env.AI_ANALYSIS_WORKER_SECRET
  if (!secret || request.headers.get('x-ai-worker-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const db = supabaseAdmin()
  const { data: rows, error } = await db.from('yeastar_call_transcriptions')
    .select('id, account_id, call_id, contact_id, created_at, yeastar_payload')
    .eq('transcription_status', 'pending')
    .order('created_at', { ascending: true })
    .limit(20)
  if (error) return NextResponse.json({ error: 'Could not load pending transcriptions' }, { status: 500 })

  let completed = 0; let stillPending = 0; let expired = 0; let failed = 0
  for (const row of (rows ?? []) as PendingRow[]) {
    const eventPayload = (row.yeastar_payload?.event ?? {}) as JsonRecord
    const expiredRow = Date.now() - new Date(row.created_at).getTime() > RETRY_WINDOW_MS
    try {
      const ai = await fetchAiResult(db, row.account_id, row.call_id, eventPayload)
      const apiError = ai.contextError
      if (ai.transcript) {
        const call = await analyzeCall(db, row.account_id, ai.transcript).catch(() => null)
        const { error: updateError } = await db.from('yeastar_call_transcriptions').update({
          transcript: ai.transcript,
          summary: call?.summary ?? null,
          key_points: call?.key_points ?? [],
          action_items: call?.action_items ?? [],
          transcription_status: 'completed',
          error_message: null,
          yeastar_payload: { event: eventPayload, ai: ai.raw },
          updated_at: new Date().toISOString(),
        }).eq('id', row.id)
        if (updateError) throw updateError
        if (call && row.contact_id) {
          await applyContactMemory(db, { accountId: row.account_id, contactId: row.contact_id, source: { type: 'call', id: row.id } }, call, call.memory).catch((memoryError) => {
            console.error('[nexo-memory] Failed to apply call memory extraction:', memoryError)
          })
        }
        completed++
      } else if (expiredRow) {
        await db.from('yeastar_call_transcriptions').update({
          transcription_status: 'unavailable',
          error_message: (apiError || 'Yeastar no publicó una transcripción dentro de la ventana de reintento.').slice(0, 500),
          yeastar_payload: { event: eventPayload, ai: ai.raw },
          updated_at: new Date().toISOString(),
        }).eq('id', row.id)
        expired++
      } else {
        if (apiError) {
          await db.from('yeastar_call_transcriptions').update({
            error_message: apiError.slice(0, 500),
            yeastar_payload: { event: eventPayload, ai: ai.raw },
            updated_at: new Date().toISOString(),
          }).eq('id', row.id)
        }
        stillPending++
      }
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : 'Error desconocido'
      if (expiredRow) {
        await db.from('yeastar_call_transcriptions').update({
          transcription_status: 'failed',
          error_message: message.slice(0, 500),
          updated_at: new Date().toISOString(),
        }).eq('id', row.id)
        failed++
      } else {
        stillPending++
      }
    }
  }
  return NextResponse.json({ completed, stillPending, expired, failed })
}
