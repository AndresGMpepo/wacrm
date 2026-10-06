import type { JsonRecord } from './yeastar-ai'

export function callCustomerPhone(payload: JsonRecord): string | null {
  const direction = String(payload.type ?? payload.call_type ?? '').toLowerCase()
  const phone = direction === 'inbound' ? payload.call_from : direction === 'outbound' ? payload.call_to : null
  return typeof phone === 'string' && phone.trim() ? phone.trim() : null
}
