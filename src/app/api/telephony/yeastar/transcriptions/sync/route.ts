import { NextResponse } from 'next/server'
import { requireEntitlement } from '@/lib/account/entitlements'
import { toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { syncTranscriptionArchive, TranscriptionArchiveError } from '@/lib/telephony/transcription-archive'
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
      return NextResponse.json({ code: 'invalid_request' }, { status: 400 })
    }
    const input = body as { phone?: unknown }
    if (input.phone != null && typeof input.phone !== 'string') {
      return NextResponse.json({ code: 'invalid_phone' }, { status: 400 })
    }
    const phone = typeof input.phone === 'string' && input.phone.trim() ? sanitizePhoneForMeta(input.phone) : undefined
    if (typeof input.phone === 'string' && input.phone.trim() && (!phone || !isValidE164(phone))) {
      return NextResponse.json({ code: 'invalid_phone' }, { status: 400 })
    }
    return NextResponse.json(await syncTranscriptionArchive(supabaseAdmin(), accountId, phone))
  } catch (error) {
    if (error instanceof TranscriptionArchiveError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[yeastar] transcript archive sync failed:', error)
    const response = toErrorResponse(error)
    return NextResponse.json(
      { code: 'transcript_sync_failed' },
      { status: response.status },
    )
  }
}
