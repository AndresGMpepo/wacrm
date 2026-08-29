import { NextResponse } from 'next/server'
import { requireAccountModule } from '@/lib/account/modules'
import { toErrorResponse } from '@/lib/auth/account'

export async function GET() {
  try {
    const { supabase, accountId } = await requireAccountModule('appointments')
    const { data, error } = await supabase.from('specialists')
      .select('id, full_name, specialty, notes, is_active')
      .eq('account_id', accountId).order('full_name')
    if (error) throw error
    return NextResponse.json({ specialists: data ?? [] })
  } catch (error) { return toErrorResponse(error) }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireAccountModule('appointments', 'agent')
    const body = await request.json().catch(() => null) as { full_name?: unknown; specialty?: unknown; notes?: unknown } | null
    const fullName = typeof body?.full_name === 'string' ? body.full_name.trim().slice(0, 160) : ''
    if (!fullName) return NextResponse.json({ error: 'El nombre del especialista es obligatorio.' }, { status: 400 })
    const { data, error } = await supabase.from('specialists').insert({
      account_id: accountId,
      full_name: fullName,
      specialty: typeof body?.specialty === 'string' ? body.specialty.trim().slice(0, 120) || null : null,
      notes: typeof body?.notes === 'string' ? body.notes.trim().slice(0, 1000) || null : null,
    }).select('id, full_name, specialty, notes, is_active').single()
    if (error) throw error
    return NextResponse.json({ specialist: data }, { status: 201 })
  } catch (error) { return toErrorResponse(error) }
}
