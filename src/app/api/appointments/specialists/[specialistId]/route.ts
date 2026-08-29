import { NextResponse } from 'next/server'
import { requireAccountModule } from '@/lib/account/modules'
import { toErrorResponse } from '@/lib/auth/account'

export async function PATCH(request: Request, { params }: { params: Promise<{ specialistId: string }> }) {
  try {
    const { specialistId } = await params
    const { supabase, accountId } = await requireAccountModule('appointments', 'agent')
    const body = await request.json().catch(() => null) as { full_name?: unknown; specialty?: unknown; notes?: unknown; is_active?: unknown } | null
    const update: Record<string, unknown> = {}
    if (typeof body?.full_name === 'string' && body.full_name.trim()) update.full_name = body.full_name.trim().slice(0, 160)
    if (typeof body?.specialty === 'string') update.specialty = body.specialty.trim().slice(0, 120) || null
    if (typeof body?.notes === 'string') update.notes = body.notes.trim().slice(0, 1000) || null
    if (typeof body?.is_active === 'boolean') update.is_active = body.is_active
    if (!Object.keys(update).length) return NextResponse.json({ error: 'No hay cambios para guardar.' }, { status: 400 })
    const { data, error } = await supabase.from('specialists').update(update).eq('id', specialistId).eq('account_id', accountId).select('id, full_name, specialty, notes, is_active').maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'El especialista no existe.' }, { status: 404 })
    return NextResponse.json({ specialist: data })
  } catch (error) { return toErrorResponse(error) }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ specialistId: string }> }) {
  try {
    const { specialistId } = await params
    const { supabase, accountId } = await requireAccountModule('appointments', 'admin')
    const { error } = await supabase.from('specialists').delete().eq('id', specialistId).eq('account_id', accountId)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) { return toErrorResponse(error) }
}
