import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { data, error } = await supabase.from('call_follow_up_policies').select('enabled, no_reply_minutes').eq('account_id', accountId).maybeSingle()
    if (error) throw error
    return NextResponse.json({ policy: data ?? { enabled: false, no_reply_minutes: 120 } })
  } catch (error) { return toErrorResponse(error) }
}

export async function PUT(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    const enabled = body?.enabled === true
    const minutes = Math.max(5, Math.min(10080, Math.floor(Number(body?.no_reply_minutes) || 120)))
    const { error } = await supabase.from('call_follow_up_policies').upsert({ account_id: accountId, enabled, no_reply_minutes: minutes })
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) { return toErrorResponse(error) }
}
