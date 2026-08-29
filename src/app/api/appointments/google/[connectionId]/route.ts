import { NextResponse } from 'next/server'
import { requireAccountModule } from '@/lib/account/modules'
import { toErrorResponse } from '@/lib/auth/account'
import { setDefaultGoogleCalendarConnection } from '@/lib/appointments/google-calendar'

export async function PATCH(request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  try {
    const { connectionId } = await params
    const { supabase, accountId } = await requireAccountModule('appointments', 'admin')
    const body = await request.json().catch(() => null) as { is_default?: unknown; display_name?: unknown } | null
    if (body?.is_default === true) {
      await setDefaultGoogleCalendarConnection(accountId, connectionId)
      return NextResponse.json({ success: true })
    }
    if (typeof body?.display_name === 'string' && body.display_name.trim()) {
      const { error } = await supabase.from('google_calendar_connections').update({ display_name: body.display_name.trim().slice(0, 120) }).eq('id', connectionId).eq('account_id', accountId)
      if (error) throw error
      return NextResponse.json({ success: true })
    }
    return NextResponse.json({ error: 'No hay cambios para guardar.' }, { status: 400 })
  } catch (error) { return toErrorResponse(error) }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  try {
    const { connectionId } = await params
    const { supabase, accountId } = await requireAccountModule('appointments', 'admin')
    const { error } = await supabase.from('google_calendar_connections').delete().eq('id', connectionId).eq('account_id', accountId)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) { return toErrorResponse(error) }
}
