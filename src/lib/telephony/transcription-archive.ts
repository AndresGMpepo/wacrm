import type { SupabaseClient } from '@supabase/supabase-js'
import { apiUrl, parsePbxLocalTime, yeastarAiConnection, type JsonRecord } from './yeastar-ai'
import { callCustomerPhone } from './call-party'

export class TranscriptionArchiveError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 502,
  ) {
    super(message)
    this.name = 'TranscriptionArchiveError'
  }
}

export function parseTranscriptionArchive(value: unknown) {
  if (!Array.isArray(value)) throw new Error('Yeastar no devolvió un archivo de transcripciones válido.')
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('El archivo contiene un tramo CDR inválido.')
    const row = item as JsonRecord
    if (typeof row.leg_id !== 'string' || !row.leg_id.trim() || typeof row.uid !== 'string') {
      throw new Error('El archivo no contiene los identificadores de tramo CDR requeridos.')
    }
    const turns = Array.isArray(row.ai_transcription) ? row.ai_transcription : []
    const transcript = turns.filter((turn) => turn && typeof turn === 'object')
      .map((turn) => turn as JsonRecord)
      .filter((turn) => !turn.type || turn.type === 'speak')
      .filter((turn) => typeof turn.content === 'string' && turn.content.trim())
      .sort((a, b) => Number(a.timestamp ?? 0) - Number(b.timestamp ?? 0))
      .map((turn) => `${typeof turn.source_number === 'string' ? `${turn.source_number}: ` : ''}${String(turn.content).trim()}`)
      .join('\n')
    const direction = String(row.call_type ?? '').toLowerCase()
    const startedAt = typeof row.time === 'string' ? parsePbxLocalTime(row.time)?.toISOString() : undefined
    return {
      cdrId: row.leg_id, uid: row.uid,
      transcript, summary: typeof row.ai_summary === 'string' ? row.ai_summary.trim() : null,
      phone: callCustomerPhone({ ...row, type: direction }),
      direction: ['inbound', 'outbound', 'internal'].includes(direction) ? direction : 'unknown',
      startedAt: startedAt ?? null,
      dateUnavailable: Boolean(transcript && !startedAt),
      duration: typeof row.call_duration === 'number' ? row.call_duration : null,
      event: {
        uid: row.uid, leg_id: row.leg_id, call_note_id: row.leg_id,
        call_from: row.call_from, call_to: row.call_to, type: direction,
        time_start: startedAt ? row.time : null, call_duration: row.call_duration,
      },
    }
  }).filter((row) => row.transcript)
}

export async function syncTranscriptionArchive(db: SupabaseClient, accountId: string, phone?: string) {
  let pbxUrl: string
  let token: string
  try {
    ({ pbxUrl, token } = await yeastarAiConnection(db, accountId))
  } catch (error) {
    console.error('[yeastar] transcript export credentials or connection unavailable:', error)
    throw new TranscriptionArchiveError('yeastar_connection_unavailable', 'No se pudo conectar con Yeastar para consultar la exportación. Las transcripciones ya guardadas no se eliminan.')
  }
  const url = apiUrl(pbxUrl, 'cdr/aidownload', 'v2.0')
  url.searchParams.set('access_token', token)
  if (phone) url.searchParams.set('call_from', phone)
  let response: Response
  let result: JsonRecord
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'OpenAPI' } })
    result = await response.json() as JsonRecord
  } catch (error) {
    console.error('[yeastar] transcript export request failed:', error)
    throw new TranscriptionArchiveError('yeastar_export_unreachable', 'No se pudo consultar la exportación de Yeastar. Comprueba que el PBX esté accesible e inténtalo de nuevo.')
  }
  if (!response.ok || result.errcode !== 0 || typeof result.download_resource_url !== 'string') {
    const pbxCode = typeof result.errcode === 'number' ? ` (código ${result.errcode})` : ''
    throw new TranscriptionArchiveError('yeastar_export_rejected', `Yeastar no autorizó o no pudo generar la exportación${pbxCode}. Revisa los permisos OpenAPI y la versión del PBX.`)
  }
  const download = new URL(result.download_resource_url, pbxUrl)
  if (download.origin !== new URL(pbxUrl).origin || !download.pathname.startsWith('/api/download/')) {
    throw new TranscriptionArchiveError('yeastar_invalid_download', 'Yeastar devolvió una dirección de descarga no válida.')
  }
  download.searchParams.set('access_token', token)
  let file: Response
  try {
    file = await fetch(download, { signal: AbortSignal.timeout(20_000), redirect: 'error' })
  } catch (error) {
    console.error('[yeastar] transcript export download failed:', error)
    throw new TranscriptionArchiveError('yeastar_download_unreachable', 'Yeastar generó la exportación, pero no se pudo descargar. Inténtalo de nuevo.')
  }
  if (!file.ok) throw new TranscriptionArchiveError('yeastar_download_failed', `Yeastar no permitió descargar la exportación (HTTP ${file.status}).`)
  const reader = file.body?.getReader()
  if (!reader) throw new TranscriptionArchiveError('yeastar_empty_export', 'Yeastar devolvió una exportación vacía.')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.length
      if (length > 10 * 1024 * 1024) {
        await reader.cancel()
        throw new TranscriptionArchiveError('yeastar_export_too_large', 'La exportación supera 10 MB. Filtra por teléfono de cliente para importar un conjunto más pequeño.', 413)
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  let rows: ReturnType<typeof parseTranscriptionArchive>
  try {
    rows = parseTranscriptionArchive(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  } catch (error) {
    if (error instanceof TranscriptionArchiveError) throw error
    console.error('[yeastar] transcript export parsing failed:', error)
    throw new TranscriptionArchiveError('yeastar_invalid_export', 'No se pudo interpretar la exportación de Yeastar. Verifica que el PBX entregue el formato de transcripciones de IA.')
  }
  if (!rows.length) return { imported: 0, updated: 0, dated: 0, remaining: 0, available: 0, alreadyPresent: 0, undated: 0 }
  if (rows.length > 2000) throw new TranscriptionArchiveError('yeastar_export_too_large', 'La exportación contiene más de 2000 tramos. Filtra por teléfono de cliente para importar un conjunto más pequeño.', 413)
  const known: {
    id: string; call_id: string; cdr_id: string; transcript: string | null; started_at: string | null
    analysis_status: string; analysis_error: string | null; summary: string | null
    key_points: unknown[] | null; action_items: unknown[] | null; memory_applied_at: string | null
  }[] = []
  for (let offset = 0; offset < rows.length; offset += 100) {
    const { data, error } = await db.from('yeastar_call_transcriptions')
      .select('id, call_id, cdr_id, transcript, started_at, analysis_status, analysis_error, summary, key_points, action_items, memory_applied_at')
      .eq('account_id', accountId).in('cdr_id', rows.slice(offset, offset + 100).map((row) => row.cdrId))
    if (error) {
      console.error('[yeastar] transcript export lookup failed:', error)
      throw new TranscriptionArchiveError('transcript_database_error', 'Yeastar entregó datos, pero NexoOmni no pudo consultar las transcripciones guardadas.', 500)
    }
    known.push(...data ?? [])
  }
  const byCdr = new Map(known.map((row) => [row.cdr_id, row]))
  const pending = rows.filter((row) => !byCdr.get(row.cdrId)?.transcript)
  const improved = rows.filter((row) => {
    const existing = byCdr.get(row.cdrId)
    return Boolean(existing?.transcript && row.transcript.length > existing.transcript.length)
  })
  const dateRepairs = rows.filter((row) => {
    const existing = byCdr.get(row.cdrId)
    return Boolean(existing?.transcript && !existing.started_at && row.startedAt)
  })
  const queuedIds = new Set([...pending, ...improved, ...dateRepairs].map((row) => row.cdrId))
  const retryIds = (known ?? []).filter((row) => row.transcript && ['failed', 'unavailable'].includes(row.analysis_status)).map((row) => row.id)
  for (let offset = 0; offset < retryIds.length; offset += 100) {
    const { error: retryError } = await db.from('yeastar_call_transcriptions').update({
      analysis_status: 'pending', next_sync_at: new Date().toISOString(),
    }).eq('account_id', accountId).in('id', retryIds.slice(offset, offset + 100))
    if (retryError) {
      console.error('[yeastar] transcript analysis retry scheduling failed:', retryError)
      throw new TranscriptionArchiveError('transcript_database_error', 'No se pudo programar el reintento de análisis en NexoOmni.', 500)
    }
  }
  const batch = [...new Map([...pending, ...improved, ...dateRepairs].map((row) => [row.cdrId, row])).values()].slice(0, 100)
  const improvedIds = new Set(improved.map((row) => row.cdrId))
  const dateRepairIds = new Set(dateRepairs.map((row) => row.cdrId))
  if (batch.length) {
    const { error: writeError } = await db.from('yeastar_call_transcriptions').upsert(batch.map((row) => ({
      account_id: accountId, call_id: byCdr.get(row.cdrId)?.call_id ?? `cdr:${row.uid}:${row.cdrId}`,
      cdr_id: row.cdrId, customer_phone: row.phone, direction: row.direction,
      started_at: row.startedAt ?? byCdr.get(row.cdrId)?.started_at ?? null,
      duration_seconds: row.duration, transcript: row.transcript,
      summary: improvedIds.has(row.cdrId) ? null
        : dateRepairIds.has(row.cdrId) ? byCdr.get(row.cdrId)?.summary ?? null
          : row.summary ?? null,
      key_points: improvedIds.has(row.cdrId) ? []
        : dateRepairIds.has(row.cdrId) ? byCdr.get(row.cdrId)?.key_points ?? []
          : [],
      action_items: improvedIds.has(row.cdrId) ? []
        : dateRepairIds.has(row.cdrId) ? byCdr.get(row.cdrId)?.action_items ?? []
          : [],
      transcription_status: 'completed',
      analysis_status: dateRepairIds.has(row.cdrId) && !improvedIds.has(row.cdrId)
        ? byCdr.get(row.cdrId)?.analysis_status ?? 'pending' : 'pending',
      analysis_error: dateRepairIds.has(row.cdrId) && !improvedIds.has(row.cdrId)
        ? byCdr.get(row.cdrId)?.analysis_error ?? null : null,
      error_message: null, yeastar_payload: { event: row.event, transcript_source: 'ai_receptionist' },
      memory_applied_at: dateRepairIds.has(row.cdrId) && !improvedIds.has(row.cdrId)
        ? byCdr.get(row.cdrId)?.memory_applied_at ?? null : null,
      next_sync_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })), { onConflict: 'account_id,call_id' })
    if (writeError) {
      console.error('[yeastar] transcript archive persistence failed:', writeError)
      throw new TranscriptionArchiveError('transcript_database_error', 'Yeastar entregó transcripciones, pero NexoOmni no pudo guardarlas.', 500)
    }
  }
  return {
    imported: batch.filter((row) => pending.some((candidate) => candidate.cdrId === row.cdrId)).length,
    updated: batch.filter((row) => improvedIds.has(row.cdrId)).length,
    dated: batch.filter((row) => dateRepairIds.has(row.cdrId)).length,
    remaining: Math.max(0, queuedIds.size - batch.length),
    available: rows.length, alreadyPresent: rows.length - queuedIds.size,
    undated: batch.filter((row) => row.dateUnavailable).length,
  }
}
