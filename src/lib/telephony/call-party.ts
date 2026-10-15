import type { JsonRecord } from './yeastar-ai'

export function callCustomerPhone(payload: JsonRecord): string | null {
  const direction = String(payload.type ?? payload.call_type ?? '').toLowerCase()
  const phone = direction === 'inbound' ? payload.call_from : direction === 'outbound' ? payload.call_to : null
  return typeof phone === 'string' && phone.trim() ? phone.trim() : null
}

export function callAgentExtension(payload: JsonRecord): string | null {
  const direction = String(payload.type ?? payload.call_type ?? '').toLowerCase()
  const raw = direction === 'inbound'
    ? payload.call_to
    : direction === 'outbound'
      ? payload.call_from
      : direction === 'internal' ? payload.call_to : null
  if (raw == null) return null
  const value = String(raw).trim()
  if (!value) return null
  const direct = /^\d{2,8}$/.exec(value)
  if (direct) return direct[0]
  const wrapped = /(?:^|[^0-9])(\d{2,8})(?![0-9])/.exec(value)
  return wrapped?.[1] ?? null
}
