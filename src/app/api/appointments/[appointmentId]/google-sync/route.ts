import { NextResponse } from 'next/server'
import { requireAccountModule } from '@/lib/account/modules'
import { toErrorResponse } from '@/lib/auth/account'
import { syncGoogleAppointment } from '@/lib/appointments/google-calendar'

export async function POST(_request: Request, { params }: { params: Promise<{ appointmentId: string }> }) {
  try {
    const { appointmentId } = await params
    const { supabase, accountId } = await requireAccountModule('appointments', 'agent')
    const { data, error } = await supabase.from('appointments')
      .select('id, title, notes, starts_at, ends_at, timezone, status, google_calendar_event_id, google_calendar_connection_id, assigned_agent_id, specialist_id, contact:contacts(name, phone)')
      .eq('id', appointmentId).eq('account_id', accountId).maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'La cita no existe.' }, { status: 404 })
    try {
      await syncGoogleAppointment(accountId, data)
      return NextResponse.json({ success: true })
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message.slice(0, 500) : 'Error desconocido de Google Calendar.'
      await supabase.from('appointments').update({ google_sync_status: 'failed', google_sync_error: message }).eq('id', data.id).eq('account_id', accountId)
      return NextResponse.json({ error: message }, { status: 502 })
    }
  } catch (error) { return toErrorResponse(error) }
}