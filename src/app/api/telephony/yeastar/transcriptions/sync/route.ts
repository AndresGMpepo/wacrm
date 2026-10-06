import { NextResponse } from 'next/server'
import { requireEntitlement } from '@/lib/account/entitlements'
import { toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { syncTranscriptionArchive } from '@/lib/telephony/transcription-archive'
import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireEntitlement('yeastar_telephony', 'supervisor')
    const rate = checkRateLimit(`yeastar-transcript-sync:${userId}`, RATE_LIMITS.send)
    if (!rate.success) return rateLimitResponse(rate)
    const body: unknown = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Se requiere un objeto JSON válido.' }, { status: 400 })
    }
    const input = body as { phone?: unknown }
    if (input.phone != null && typeof input.phone !== 'string') {
      return NextResponse.json({ error: 'El teléfono debe ser texto en formato internacional.' }, { status: 400 })
    }
    const phone = typeof input.phone === 'string' && input.phone.trim() ? sanitizePhoneForMeta(input.phone) : undefined
    if (typeof input.phone === 'string' && input.phone.trim() && (!phone || !isValidE164(phone))) {
      return NextResponse.json({ error: 'Introduce un teléfono internacional válido.' }, { status: 400 })
    }
    return NextResponse.json(await syncTranscriptionArchive(supabaseAdmin(), accountId, phone))
  } catch (error) { return toErrorResponse(error) }
}
