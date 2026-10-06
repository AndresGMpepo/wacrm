import type { SupabaseClient } from '@supabase/supabase-js'
import { apiUrl, parsePbxLocalTime, yeastarAiConnection, type JsonRecord } from './yeastar-ai'
import { callCustomerPhone } from './call-party'

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
    const event = { ...row, type: direction, time_start: row.time }
    const startedAt = typeof row.time === 'string' ? parsePbxLocalTime(row.time)?.toISOString() : undefined
    if (transcript && !startedAt) throw new Error('No se pudo interpretar la fecha de una llamada del archivo de Yeastar.')
    return {
      cdrId: row.leg_id, uid: row.uid,
      transcript, summary: typeof row.ai_summary === 'string' ? row.ai_summary.trim() : null,
      phone: callCustomerPhone(event),
      direction: ['inbound', 'outbound', 'internal'].includes(direction) ? direction : 'unknown',
      startedAt: startedAt ?? null,
      duration: typeof row.call_duration === 'number' ? row.call_duration : null,
      event,
    }
  }).filter((row) => row.transcript)
}

export async function syncTranscriptionArchive(db: SupabaseClient, accountId: string, phone?: string) {
  const { pbxUrl, token } = await yeastarAiConnection(db, accountId)
  const url = apiUrl(pbxUrl, 'cdr/aidownload', 'v2.0')
  url.searchParams.set('access_token', token)
  if (phone) url.searchParams.set('call_from', phone)
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'OpenAPI' } })
  const result = await response.json() as JsonRecord
  if (!response.ok || result.errcode !== 0 || typeof result.download_resource_url !== 'string') {
    throw new Error('Yeastar no pudo exportar las transcripciones. Revisa la versión y los permisos OpenAPI del PBX.')
  }
  const download = new URL(result.download_resource_url, pbxUrl)
  if (download.origin !== new URL(pbxUrl).origin || !download.pathname.startsWith('/api/download/')) {
    throw new Error('Yeastar devolvió una dirección de descarga no válida.')
  }
  download.searchParams.set('access_token', token)
  const file = await fetch(download, { signal: AbortSignal.timeout(20_000), redirect: 'error' })
  if (!file.ok) throw new Error('No se pudo descargar el archivo de transcripciones de Yeastar.')
  const reader = file.body?.getReader()
  if (!reader) throw new Error('El archivo de transcripciones está vacío.')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.length
      if (length > 10 * 1024 * 1024) {
        await reader.cancel()
        throw new Error('El archivo excede 10 MB. Sincroniza filtrando por el número del cliente.')
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const rows = parseTranscriptionArchive(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  if (!rows.length) return { imported: 0, remaining: 0 }
  if (rows.length > 2000) throw new Error('El archivo contiene más de 2000 tramos. Sincroniza por número del cliente.')
  const known: { id: string; call_id: string; cdr_id: string; transcript: string | null; analysis_status: string }[] = []
  for (let offset = 0; offset < rows.length; offset += 100) {
    const { data, error } = await db.from('yeastar_call_transcriptions')
      .select('id, call_id, cdr_id, transcript, analysis_status')
      .eq('account_id', accountId).in('cdr_id', rows.slice(offset, offset + 100).map((row) => row.cdrId))
    if (error) throw error
    known.push(...data ?? [])
  }
  const byCdr = new Map(known.map((row) => [row.cdr_id, row]))
  const pending = rows.filter((row) => {
    const existing = byCdr.get(row.cdrId)
    return !existing?.transcript
  })
  const retryIds = (known ?? []).filter((row) => row.transcript && ['failed', 'unavailable'].includes(row.analysis_status)).map((row) => row.id)
  for (let offset = 0; offset < retryIds.length; offset += 100) {
    const { error: retryError } = await db.from('yeastar_call_transcriptions').update({
      analysis_status: 'pending', next_sync_at: new Date().toISOString(),
    }).eq('account_id', accountId).in('id', retryIds.slice(offset, offset + 100))
    if (retryError) throw retryError
  }
  const batch = pending.slice(0, 100)
  if (batch.length) {
    const { error: writeError } = await db.from('yeastar_call_transcriptions').upsert(batch.map((row) => ({
      account_id: accountId, call_id: byCdr.get(row.cdrId)?.call_id ?? `cdr:${row.uid}:${row.cdrId}`,
      cdr_id: row.cdrId, customer_phone: row.phone, direction: row.direction,
      started_at: row.startedAt, duration_seconds: row.duration, transcript: row.transcript,
      ...(row.summary ? { summary: row.summary } : {}),
      transcription_status: 'completed', analysis_status: 'pending', analysis_error: null,
      error_message: null, yeastar_payload: { event: row.event },
      next_sync_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })), { onConflict: 'account_id,call_id' })
    if (writeError) throw writeError
  }
  return { imported: batch.length, remaining: Math.max(0, pending.length - batch.length) }
}
