import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

const defaults = { enabled: false, mode: 'round_robin' as const }

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { data, error } = await supabase
      .from('conversation_assignment_policies')
      .select('enabled, mode')
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) throw error
    return NextResponse.json({ policy: data ?? defaults })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PUT(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    const enabled = body?.enabled === true
    const mode = body?.mode === 'least_open' ? 'least_open' : 'round_robin'
    const { error } = await supabase
      .from('conversation_assignment_policies')
      .upsert({ account_id: accountId, enabled, mode })
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
