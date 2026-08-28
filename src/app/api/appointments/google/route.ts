import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { requireAccountModule } from '@/lib/account/modules'
import { toErrorResponse } from '@/lib/auth/account'
import { addGoogleCalendarConnection, googleAuthorizeUrl, googleCalendarConfigured, listGoogleCalendars, setDefaultGoogleCalendarConnection } from '@/lib/appointments/google-calendar'

function admin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}
function origin(request: Request) { return (process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.APP_URL?.trim() || new URL(request.url).origin).replace(/\/$/, '') }

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireAccountModule('appointments', 'admin')
    const url = new URL(request.url)
    const calendarFor = url.searchParams.get('calendar_for')
    if (calendarFor) return NextResponse.json({ calendars: await listGoogleCalendars(accountId, calendarFor) })
    const { data, error } = await supabase.from('google_calendar_connections').select('id, assigned_agent_id, calendar_id, display_name, is_default, connected_at, last_synced_at, last_error').eq('account_id', accountId).order('connected_at', { ascending: false })
    if (error) throw error
    return NextResponse.json({ configured: googleCalendarConfigured(), connections: data ?? [] })
  } catch (error) { return toErrorResponse(error) }
}

export async function POST(request: Request) {
  try {
    const { accountId, userId, supabase } = await requireAccountModule('appointments', 'admin')
    if (!googleCalendarConfigured()) return NextResponse.json({ error: 'Google Calendar no está configurado en el servidor.' }, { status: 503 })
    const body = await request.json().catch(() => null) as { action?: unknown; assigned_agent_id?: unknown; connection_id?: unknown; calendar_id?: unknown } | null
    if (body?.action === 'add_calendar') {
      if (typeof body.connection_id !== 'string' || typeof body.calendar_id !== 'string') return NextResponse.json({ error: 'Selecciona la cuenta y el calendario de Google.' }, { status: 400 })
      return NextResponse.json({ connection: await addGoogleCalendarConnection(accountId, body.connection_id, body.calendar_id) })
    }
    if (body?.action === 'set_default') {
      if (typeof body.connection_id !== 'string') return NextResponse.json({ error: 'Selecciona el calendario predeterminado.' }, { status: 400 })
      await setDefaultGoogleCalendarConnection(accountId, body.connection_id)
      return NextResponse.json({ ok: true })
    }
    const assignedAgentId = typeof body?.assigned_agent_id === 'string' && body.assigned_agent_id.trim() ? body.assigned_agent_id : null
    if (assignedAgentId) {
      const { data: member, error: memberError } = await supabase.from('profiles').select('user_id').eq('user_id', assignedAgentId).eq('account_id', accountId).eq('is_active', true).maybeSingle()
      if (memberError) throw memberError
      if (!member) return NextResponse.json({ error: 'El responsable no está activo en esta cuenta.' }, { status: 400 })
    }
    const state = randomUUID()
    const redirectUri = `${origin(request)}/api/appointments/google/callback`
    const { error } = await admin().from('google_calendar_oauth_attempts').insert({ state, account_id: accountId, user_id: userId, assigned_agent_id: assignedAgentId, redirect_uri: redirectUri, expires_at: new Date(Date.now() + 15 * 60_000).toISOString() })
    if (error) throw error
    return NextResponse.json({ authorize_url: googleAuthorizeUrl(redirectUri, state) })
  } catch (error) { return toErrorResponse(error) }
}
