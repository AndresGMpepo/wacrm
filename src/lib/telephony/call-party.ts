import type { JsonRecord } from './yeastar-ai'

export function callCustomerPhone(payload: JsonRecord): string | null {
  const direction = String(payload.type ?? payload.call_type ?? '').toLowerCase()
  const phone = direction === 'inbound' ? payload.call_from : direction === 'outbound' ? payload.call_to : null
  return typeof phone === 'string' && phone.trim() ? phone.trim() : null
}

export function isAiReceptionistTranscript(payload: JsonRecord | null | undefined): boolean {
  if (payload?.transcript_source === 'ai_receptionist') return true
  const ai = payload?.ai
  return Boolean(ai && typeof ai === 'object' && 'context' in ai)
}

export function isUsefulCallTranscript(row: {
  transcript: string | null
  summary: string | null
  agent_user_id: string | null
  yeastar_payload: JsonRecord | null
}): boolean {
  return Boolean(row.transcript?.trim() || row.summary?.trim() || row.agent_user_id || isAiReceptionistTranscript(row.yeastar_payload))
}
