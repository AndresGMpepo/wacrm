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

/** Creates the specialist inline when the connect dialog registers a new doctor on the spot. */
async function resolveSpecialist(
  supabase: Awaited<ReturnType<typeof requireAccountModule>>['supabase'],
  accountId: string,
  specialistId: unknown,
  newSpecialist: unknown,
): Promise<string | null> {
  if (typeof specialistId === 'string' && specialistId.trim()) {
    const { data, error } = await supabase.from('specialists').select('id').eq('id', specialistId).eq('account_id', accountId).maybeSingle()
    if (error) throw error
    if (!data) throw new Error('Ese especialista no existe en esta cuenta.')
    return data.id
  }
  const draft = newSpecialist as { full_name?: unknown; specialty?: unknown } | null
  const fullName = typeof draft?.full_name === 'string' ? draft.full_name.trim().slice(0, 160) : ''
  if (!fullName) return null
  const { data, error } = await supabase.from('specialists').insert({
    account_id: accountId, full_name: fullName,
    specialty: typeof draft?.specialty === 'string' ? draft.specialty.trim().slice(0, 120) || null : null,
  }).select('id').single()
  if (error) throw error
  return data.id
}

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireAccountModule('appointments', 'admin')
    const url = new URL(request.url)
    const calendarFor = url.searchParams.get('calendar_for')
    if (calendarFor) {
      const calendars = await listGoogleCalendars(accountId, calendarFor)
      return NextResponse.json({ calendars })
    }
    const { data, error } = await supabase.from('google_calendar_connections')
      .select('id, assigned_agent_id, specialist_id, calendar_id, display_name, is_default, connected_at, last_synced_at, last_error')
      .eq('account_id', accountId).order('connected_at', { ascending: false })
    if (error) throw error
    const specialistIds = [...new Set((data ?? []).map((row) => row.specialist_id).filter((id): id is string => Boolean(id)))]
    const { data: specialists, error: specialistsError } = specialistIds.length
      ? await supabase.from('specialists').select('id, full_name, specialty').in('id', specialistIds)
      : { data: [] as { id: string; full_name: string; specialty: string | null }[], error: null }
    if (specialistsError) throw specialistsError
    const specialistById = new Map((specialists ?? []).map((specialist) => [specialist.id, specialist]))
    const connections = (data ?? []).map((row) => ({ ...row, specialist: row.specialist_id ? specialistById.get(row.specialist_id) ?? null : null }))
    return NextResponse.json({ configured: googleCalendarConfigured(), connections })
  } catch (error) { return toErrorResponse(error) }
}

export async function POST(request: Request) {
  try {
    const { accountId, userId, supabase } = await requireAccountModule('appointments', 'admin')
    if (!googleCalendarConfigured()) return NextResponse.json({ error: 'Google Calendar no está configurado en el servidor.' }, { status: 503 })
    const body = await request.json().catch(() => null) as Record<string, unknown> | null

    if (body?.action === 'add_calendar') {
      const connectionId = typeof body.connection_id === 'string' ? body.connection_id : ''
      const calendarId = typeof body.calendar_id === 'string' ? body.calendar_id : ''
      if (!connectionId || !calendarId) return NextResponse.json({ error: 'Selecciona una conexión y un calendario.' }, { status: 400 })
      const specialistId = await resolveSpecialist(supabase, accountId, body.specialist_id, body.new_specialist)
      const connection = await addGoogleCalendarConnection(accountId, connectionId, calendarId, specialistId)
      return NextResponse.json({ connection }, { status: 201 })
    }

    if (body?.action === 'set_default') {
      const connectionId = typeof body.connection_id === 'string' ? body.connection_id : ''
      if (!connectionId) return NextResponse.json({ error: 'Selecciona un calendario.' }, { status: 400 })
      await setDefaultGoogleCalendarConnection(accountId, connectionId)
      return NextResponse.json({ success: true })
    }

    const specialistId = await resolveSpecialist(supabase, accountId, body?.specialist_id, body?.new_specialist)
    const state = randomUUID()
    const redirectUri = `${origin(request)}/api/appointments/google/callback`
    const { error } = await admin().from('google_calendar_oauth_attempts').insert({ state, account_id: accountId, user_id: userId, specialist_id: specialistId, redirect_uri: redirectUri, expires_at: new Date(Date.now() + 15 * 60_000).toISOString() })
    if (error) throw error
    return NextResponse.json({ authorize_url: googleAuthorizeUrl(redirectUri, state) })
  } catch (error) { return toErrorResponse(error) }
}
