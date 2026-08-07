import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

export const dynamic = 'force-dynamic'

function admin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

async function ownExtension(accountId: string, userId: string) {
  const result = await admin().from('telephony_user_configs').select('extension')
    .eq('account_id', accountId).eq('user_id', userId).eq('provider', 'yeastar').maybeSingle()
  if (result.error) throw result.error
  return result.data?.extension ?? null
}

function payload(body: unknown) {
  const value = body as { callId?: unknown; number?: unknown; direction?: unknown; status?: unknown }
  const callId = typeof value?.callId === 'string' ? value.callId.trim() : ''
  if (!callId) return null
  return {
    callId,
    number: typeof value.number === 'string' ? value.number.trim().slice(0, 80) || null : null,
    direction: value.direction === 'inbound' || value.direction === 'outbound' ? value.direction : 'unknown',
    status: typeof value.status === 'string' ? value.status.trim().slice(0, 40) || 'ANSWER' : 'ANSWER',
  }
}

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('agent')
    const call = payload(await request.json().catch(() => null))
    if (!call) return NextResponse.json({ error: 'callId es obligatorio.' }, { status: 400 })
    const extension = await ownExtension(accountId, userId)
    if (!extension) return NextResponse.json({ error: 'Configura tu extensión Yeastar antes de supervisar llamadas.' }, { status: 409 })
    const { error } = await admin().from('yeastar_live_calls').upsert({
      account_id: accountId,
      call_id: `wacrm:${call.callId}`,
      extension,
      channel_id: `wacrm:${call.callId}`,
      peer_number: call.number,
      direction: call.direction,
      status: call.status,
      last_event_at: new Date().toISOString(),
    }, { onConflict: 'account_id,call_id,extension' })
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(request: Request) {
  try {
    const { accountId, userId } = await requireRole('agent')
    const call = payload(await request.json().catch(() => null))
    if (!call) return NextResponse.json({ error: 'callId es obligatorio.' }, { status: 400 })
    const extension = await ownExtension(accountId, userId)
    if (!extension) return NextResponse.json({ ok: true })
    const { error } = await admin().from('yeastar_live_calls').delete()
      .eq('account_id', accountId).eq('extension', extension).eq('call_id', `wacrm:${call.callId}`)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
