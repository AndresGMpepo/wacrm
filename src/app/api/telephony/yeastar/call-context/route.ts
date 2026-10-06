import { NextResponse } from 'next/server'
import { requireEntitlement } from '@/lib/account/entitlements'
import { toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { loadOwnCallContext } from '@/lib/telephony/call-context'

export async function GET(request: Request) {
  try {
    const { accountId, userId } = await requireEntitlement('yeastar_telephony', 'agent')
    const callId = new URL(request.url).searchParams.get('call_id')?.trim()
    if (!callId || callId.length > 120) return NextResponse.json({ error: 'Se requiere un identificador de llamada válido.' }, { status: 400 })
    const context = await loadOwnCallContext(supabaseAdmin(), accountId, userId, callId)
    if (!context) return NextResponse.json({ error: 'La llamada aún no está registrada en tu extensión.' }, { status: 409 })
    return NextResponse.json(context)
  } catch (error) { return toErrorResponse(error) }
}
