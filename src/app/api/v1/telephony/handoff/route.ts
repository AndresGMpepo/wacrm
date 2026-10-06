import { requireApiKey } from '@/lib/auth/api-context'
import { badRequest, forbidden, ok, toApiErrorResponse } from '@/lib/api/v1/respond'
import { getAccountEntitlements } from '@/lib/account/entitlements'
import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'
import { findLiveCallerCall } from '@/lib/telephony/call-context'

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'call-context:write')
    const entitlements = await getAccountEntitlements(ctx.supabase, ctx.accountId)
    if (!entitlements?.features.yeastar_telephony) throw forbidden('Telephony is not enabled for this account')
    const raw = await request.json().catch(() => { throw badRequest('Invalid JSON body') })
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw badRequest('Expected a JSON object')
    const body = raw as Record<string, unknown>
    const phone = typeof body.customer_phone === 'string' ? sanitizePhoneForMeta(body.customer_phone) : ''
    if (body.customer_phone != null && (typeof body.customer_phone !== 'string' || !isValidE164(phone))) {
      throw badRequest('customer_phone must be an international phone number')
    }
    const bounded = (key: string, max: number, required = false) => {
      const value = body[key]
      if (value == null && !required) return null
      if (typeof value !== 'string' || !value.trim() || value.length > max) {
        throw badRequest(`${key} must be nonempty text with at most ${max} characters`)
      }
      return value.trim()
    }
    const summary = bounded('summary', 800, true)
    const need = bounded('customer_need', 400)
    const next = bounded('next_action', 400)
    const suppliedId = bounded('call_id', 120)
    const aiExtension = bounded('ai_extension', 20)
    if (!phone && !aiExtension && !suppliedId) throw badRequest('Provide customer_phone, ai_extension or call_id')
    const call = await findLiveCallerCall(ctx.supabase, ctx.accountId, phone || undefined, suppliedId ?? undefined, aiExtension ?? undefined)
    if (!call) throw badRequest('No unique active inbound call matches this caller. Do not transfer as though context was saved.')
    const { error } = await ctx.supabase.from('yeastar_call_handoffs').upsert({
      account_id: ctx.accountId, call_id: call.callId, customer_phone: call.phone,
      summary, customer_need: need, next_action: next, updated_at: new Date().toISOString(),
    }, { onConflict: 'account_id,call_id' })
    if (error) throw error
    return ok({ saved: true, call_id: call.callId })
  } catch (error) { return toApiErrorResponse(error) }
}
