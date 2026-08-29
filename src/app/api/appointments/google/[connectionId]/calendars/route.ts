import { NextResponse } from 'next/server'
import { requireAccountModule } from '@/lib/account/modules'
import { toErrorResponse } from '@/lib/auth/account'
import { addGoogleCalendarConnection, listGoogleCalendars } from '@/lib/appointments/google-calendar'

export async function GET(_request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  try {
    const { connectionId } = await params
    const { accountId } = await requireAccountModule('appointments', 'admin')
    const calendars = await listGoogleCalendars(accountId, connectionId)
    return NextResponse.json({ calendars })
  } catch (error) { return toErrorResponse(error) }
}

export async function POST(request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  try {
    const { connectionId } = await params
    const { supabase, accountId } = await requireAccountModule('appointments', 'admin')
    const body = await request.json().catch(() => null) as { calendar_id?: unknown; assigned_agent_id?: unknown } | null
    const calendarId = typeof body?.calendar_id === 'string' ? body.calendar_id.trim() : ''
    if (!calendarId) return NextResponse.json({ error: 'Selecciona un calendario.' }, { status: 400 })
    let targetAgentId: string | null | undefined
    if (typeof body?.assigned_agent_id === 'string' && body.assigned_agent_id.trim()) {
      const { data: member, error: memberError } = await supabase.from('profiles').select('user_id').eq('user_id', body.assigned_agent_id).eq('account_id', accountId).eq('is_active', true).maybeSingle()
      if (memberError) throw memberError
      if (!member) return NextResponse.json({ error: 'El responsable no está activo en esta cuenta.' }, { status: 400 })
      targetAgentId = body.assigned_agent_id
    } else if (body?.assigned_agent_id === null) {
      targetAgentId = null
    }
    const connection = await addGoogleCalendarConnection(accountId, connectionId, calendarId, targetAgentId)
    return NextResponse.json({ connection }, { status: 201 })
  } catch (error) { return toErrorResponse(error) }
}
