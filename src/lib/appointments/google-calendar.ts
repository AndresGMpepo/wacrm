import { createClient as createAdminClient } from '@supabase/supabase-js'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'

type AppointmentForGoogle = { id: string; title: string; notes: string | null; starts_at: string; ends_at: string; timezone: string; status: string; google_calendar_event_id: string | null; google_calendar_connection_id?: string | null; assigned_agent_id: string | null; specialist_id?: string | null; contact?: { name: string | null; phone: string | null } | { name: string | null; phone: string | null }[] | null }
type GoogleConnection = { id: string; account_id: string; assigned_agent_id: string | null; specialist_id: string | null; calendar_id: string; encrypted_access_token: string; encrypted_refresh_token: string; access_token_expires_at: string | null; sync_token: string | null }
type GoogleCalendarListItem = { id: string; summary: string; primary?: boolean }

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Falta la configuración del servidor.')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

function credentials() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) throw new Error('Google Calendar no está configurado en el servidor.')
  return { clientId, clientSecret }
}

export function googleCalendarConfigured() {
  return Boolean(process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim() && process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim())
}

export function googleAuthorizeUrl(redirectUri: string, state: string) {
  const { clientId } = credentials()
  // Always show Google's account picker. This prevents a specialist calendar
  // connection from silently reusing the account already selected for the
  // organisation's general calendar.
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', access_type: 'offline', prompt: 'consent select_account', scope: 'https://www.googleapis.com/auth/calendar', state })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export async function exchangeGoogleCode(code: string, redirectUri: string) {
  const { clientId, clientSecret } = credentials()
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }), signal: AbortSignal.timeout(10_000) })
  const data = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string }
  if (!response.ok || !data.access_token || !data.refresh_token) throw new Error(data.error_description || 'Google no devolvió los permisos de calendario requeridos.')
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString() }
}

/** Resolution order: an explicit connection id, then the doctor's own default
 *  calendar, then (legacy rows only) a connection scoped to an internal
 *  agent, then the account's general default. */
async function accessToken(accountId: string, scope: { specialistId: string | null; assignedAgentId: string | null }, connectionId?: string | null) {
  const db = admin()
  const columns = 'id, calendar_id, encrypted_access_token, encrypted_refresh_token, access_token_expires_at'
  const chosen = connectionId ? await db.from('google_calendar_connections').select(columns).eq('id', connectionId).eq('account_id', accountId).maybeSingle() : null
  const bySpecialist = chosen?.data ? chosen : scope.specialistId
    ? await db.from('google_calendar_connections').select(columns).eq('account_id', accountId).eq('specialist_id', scope.specialistId).eq('is_default', true).maybeSingle()
    : { data: null, error: null }
  if (bySpecialist.error) throw bySpecialist.error
  const byAgent = bySpecialist.data ? bySpecialist : scope.assignedAgentId
    ? await db.from('google_calendar_connections').select(columns).eq('account_id', accountId).eq('assigned_agent_id', scope.assignedAgentId).is('specialist_id', null).eq('is_default', true).maybeSingle()
    : { data: null, error: null }
  if (byAgent.error) throw byAgent.error
  const fallback = byAgent.data ? { data: null, error: null } : await db.from('google_calendar_connections').select(columns).eq('account_id', accountId).is('assigned_agent_id', null).is('specialist_id', null).eq('is_default', true).maybeSingle()
  const { data, error } = byAgent.data ? byAgent : fallback
  if (error) throw error
  if (!data) return null
  if (!data.access_token_expires_at || new Date(data.access_token_expires_at).getTime() > Date.now() + 60_000) return { db, calendarId: data.calendar_id, token: decrypt(data.encrypted_access_token), connectionId: data.id }
  const { clientId, clientSecret } = credentials()
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: decrypt(data.encrypted_refresh_token), grant_type: 'refresh_token' }), signal: AbortSignal.timeout(10_000) })
  const refreshed = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number }
  if (!response.ok || !refreshed.access_token) throw new Error('No se pudo renovar la conexión de Google Calendar.')
  const expiresAt = new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000).toISOString()
  await db.from('google_calendar_connections').update({ encrypted_access_token: encrypt(refreshed.access_token), access_token_expires_at: expiresAt }).eq('id', data.id)
  return { db, calendarId: data.calendar_id, token: refreshed.access_token, connectionId: data.id }
}

/**
 * Busy ranges the specialist (or agent) already has in Google.
 *
 * Availability without this offers slots the person is not actually free
 * for: anything booked straight into their Google Calendar is invisible to
 * us. Best-effort by design — a Google outage must degrade to "we only know
 * our own bookings", never break the booking flow.
 */
export async function getGoogleBusy(
  accountId: string,
  scope: { specialistId: string | null; assignedAgentId: string | null },
  from: Date,
  to: Date,
): Promise<{ start: Date; end: Date }[]> {
  if (!googleCalendarConfigured()) return []
  let connection: Awaited<ReturnType<typeof accessToken>> = null
  try {
    connection = await accessToken(accountId, scope)
  } catch (error) {
    console.error('[appointments] could not read the Google connection:', error)
    return []
  }
  if (!connection) return []

  try {
    const response = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        items: [{ id: connection.calendarId || 'primary' }],
      }),
      signal: AbortSignal.timeout(10_000),
    })
    const payload = (await response.json().catch(() => ({}))) as {
      calendars?: Record<string, { busy?: { start: string; end: string }[] }>
    }
    if (!response.ok) return []
    return Object.values(payload.calendars ?? {})
      .flatMap((calendar) => calendar.busy ?? [])
      .map((slot) => ({ start: new Date(slot.start), end: new Date(slot.end) }))
      .filter((slot) => !Number.isNaN(slot.start.getTime()) && !Number.isNaN(slot.end.getTime()))
  } catch (error) {
    console.error('[appointments] Google freeBusy query failed:', error)
    return []
  }
}

function eventBody(appointment: AppointmentForGoogle) {  const contactRow = Array.isArray(appointment.contact) ? appointment.contact[0] : appointment.contact
  const contact = contactRow?.name || contactRow?.phone
  return { summary: appointment.title, description: [appointment.notes, contact ? `Cliente: ${contact}` : null, `NexoOmni appointment: ${appointment.id}`].filter(Boolean).join('\n'), start: { dateTime: appointment.starts_at, timeZone: appointment.timezone || 'UTC' }, end: { dateTime: appointment.ends_at, timeZone: appointment.timezone || 'UTC' } }
}

export async function syncGoogleAppointment(accountId: string, appointment: AppointmentForGoogle) {
  const connection = await accessToken(accountId, { specialistId: appointment.specialist_id ?? null, assignedAgentId: appointment.assigned_agent_id }, appointment.google_calendar_connection_id)
  if (!connection) {
    await admin().from('appointments').update({ google_sync_status: 'not_connected', google_sync_error: null }).eq('id', appointment.id).eq('account_id', accountId)
    return
  }
  await connection.db.from('appointments').update({ google_sync_status: 'pending', google_sync_error: null, google_calendar_connection_id: connection.connectionId }).eq('id', appointment.id).eq('account_id', accountId)
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(connection.calendarId)}/events`
  if (appointment.status === 'cancelled' && appointment.google_calendar_event_id) {
    const response = await fetch(`${base}/${encodeURIComponent(appointment.google_calendar_event_id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${connection.token}` }, signal: AbortSignal.timeout(10_000) })
    if (!response.ok && response.status !== 404) throw new Error('No se pudo cancelar el evento en Google Calendar.')
    await connection.db.from('appointments').update({ google_calendar_event_id: null, google_sync_status: 'synced', google_sync_error: null }).eq('id', appointment.id).eq('account_id', accountId)
    return
  }
  if (appointment.status === 'cancelled') return
  let response = await fetch(appointment.google_calendar_event_id ? `${base}/${encodeURIComponent(appointment.google_calendar_event_id)}` : base, { method: appointment.google_calendar_event_id ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(eventBody(appointment)), signal: AbortSignal.timeout(10_000) })
  // The doctor (or someone else) may have deleted the event straight from Google:
  // a PATCH to a gone event 404s, so recreate it instead of failing the whole edit.
  if (response.status === 404 && appointment.google_calendar_event_id) {
    response = await fetch(base, { method: 'POST', headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(eventBody(appointment)), signal: AbortSignal.timeout(10_000) })
  }
  const event = await response.json().catch(() => ({})) as { id?: string }
  if (!response.ok || !event.id) throw new Error('No se pudo sincronizar la cita en Google Calendar.')
  await connection.db.from('appointments').update({ google_calendar_event_id: event.id, google_sync_status: 'synced', google_sync_error: null }).eq('id', appointment.id).eq('account_id', accountId)
}

/** Best-effort cleanup of the Google-side event when an appointment is hard-deleted
 *  from NexoOmni. Tolerant of the event already being gone (deleted from Google itself). */
export async function deleteGoogleEvent(accountId: string, appointment: Pick<AppointmentForGoogle, 'google_calendar_connection_id' | 'google_calendar_event_id' | 'specialist_id' | 'assigned_agent_id'>) {
  if (!appointment.google_calendar_event_id) return
  const connection = await accessToken(accountId, { specialistId: appointment.specialist_id ?? null, assignedAgentId: appointment.assigned_agent_id }, appointment.google_calendar_connection_id)
  if (!connection) return
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(connection.calendarId)}/events`
  const response = await fetch(`${base}/${encodeURIComponent(appointment.google_calendar_event_id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${connection.token}` }, signal: AbortSignal.timeout(10_000) })
  if (!response.ok && response.status !== 404 && response.status !== 410) throw new Error('No se pudo eliminar el evento en Google Calendar.')
}

/** Deletes a connection and, if it was the scope's default, promotes another
 *  remaining connection in the same scope so the doctor/company isn't left
 *  without a default calendar. */
export async function removeGoogleCalendarConnection(accountId: string, connectionId: string) {
  const db = admin()
  const { data: connection, error } = await db.from('google_calendar_connections').select('id, assigned_agent_id, specialist_id, is_default').eq('id', connectionId).eq('account_id', accountId).maybeSingle()
  if (error) throw error
  if (!connection) throw new Error('No se encontró el calendario.')
  const { error: deleteError } = await db.from('google_calendar_connections').delete().eq('id', connectionId).eq('account_id', accountId)
  if (deleteError) throw deleteError
  if (!connection.is_default) return
  let scope = db.from('google_calendar_connections').select('id').eq('account_id', accountId)
  scope = connection.assigned_agent_id ? scope.eq('assigned_agent_id', connection.assigned_agent_id) : scope.is('assigned_agent_id', null)
  scope = connection.specialist_id ? scope.eq('specialist_id', connection.specialist_id) : scope.is('specialist_id', null)
  const { data: remaining, error: remainingError } = await scope.limit(1).maybeSingle()
  if (remainingError) throw remainingError
  if (remaining) await db.from('google_calendar_connections').update({ is_default: true }).eq('id', remaining.id)
}

async function googleRequest(token: string, path: string) {
  const response = await fetch(`https://www.googleapis.com/calendar/v3/${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) })
  const data = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) throw new Error(typeof data.error === 'object' && data.error ? String((data.error as { message?: string }).message ?? 'Google Calendar rechazó la solicitud.') : 'Google Calendar rechazó la solicitud.')
  return data
}

function auditGoogleChange(db: ReturnType<typeof admin>, accountId: string, appointmentId: string, action: string, beforeData: Record<string, unknown>, afterData: Record<string, unknown>) {
  return db.from('appointment_audit_log').insert({ account_id: accountId, appointment_id: appointmentId, actor_user_id: null, source: 'google_calendar', action, before_data: beforeData, after_data: afterData })
}

type GoogleEvent = { id?: string; status?: string; summary?: string; start?: { dateTime?: string; timeZone?: string }; end?: { dateTime?: string; timeZone?: string }; updated?: string; creator?: { email?: string }; organizer?: { email?: string } }

/** Only imports updates to events already created by NexoOmni. */
export async function syncGoogleCalendarChanges() {
  const db = admin()
  const { data: connections, error } = await db.from('google_calendar_connections').select('id, account_id, calendar_id, sync_token')
  if (error) throw error
  const summary = { checked: 0, updated: 0, cancelled: 0, failed: 0 }
  for (const connectionRow of connections ?? []) {
    summary.checked += 1
    try {
      const connection = await accessToken(connectionRow.account_id, { specialistId: null, assignedAgentId: null }, connectionRow.id)
      if (!connection) continue
      let pageToken: string | undefined
      let nextSyncToken: string | null = null
      do {
        const params = new URLSearchParams({ singleEvents: 'true', showDeleted: 'true', maxResults: '250' })
        if (connectionRow.sync_token) params.set('syncToken', connectionRow.sync_token)
        else params.set('timeMin', new Date(Date.now() - 90 * 86_400_000).toISOString())
        if (pageToken) params.set('pageToken', pageToken)
        const result = await googleRequest(connection.token, `calendars/${encodeURIComponent(connection.calendarId)}/events?${params.toString()}`) as { items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string }
        pageToken = result.nextPageToken
        if (result.nextSyncToken) nextSyncToken = result.nextSyncToken
        for (const event of result.items ?? []) {
          if (!event.id) continue
          const { data: appointment, error: appointmentError } = await db.from('appointments').select('id, title, starts_at, ends_at, timezone, status, google_calendar_event_id').eq('account_id', connectionRow.account_id).eq('google_calendar_connection_id', connectionRow.id).eq('google_calendar_event_id', event.id).maybeSingle()
          if (appointmentError) throw appointmentError
          if (!appointment) continue
          const before = { title: appointment.title, starts_at: appointment.starts_at, ends_at: appointment.ends_at, timezone: appointment.timezone, status: appointment.status }
          const metadata = { updated_at: event.updated ?? null, creator: event.creator?.email ?? null, organizer: event.organizer?.email ?? null }
          if (event.status === 'cancelled') {
            if (appointment.status !== 'cancelled') {
              const { error: updateError } = await db.from('appointments').update({ status: 'cancelled', google_sync_status: 'synced', google_sync_error: null }).eq('id', appointment.id).eq('account_id', connectionRow.account_id)
              if (updateError) throw updateError
              await auditGoogleChange(db, connectionRow.account_id, appointment.id, 'cancelled_from_google', before, { ...before, status: 'cancelled', google: metadata })
              summary.cancelled += 1
            }
            continue
          }
          const update = { title: event.summary?.trim().slice(0, 160) || appointment.title, starts_at: event.start?.dateTime ? new Date(event.start.dateTime).toISOString() : appointment.starts_at, ends_at: event.end?.dateTime ? new Date(event.end.dateTime).toISOString() : appointment.ends_at, timezone: event.start?.timeZone || appointment.timezone, google_sync_status: 'synced', google_sync_error: null }
          if (JSON.stringify(before) !== JSON.stringify({ title: update.title, starts_at: update.starts_at, ends_at: update.ends_at, timezone: update.timezone, status: appointment.status })) {
            const { error: updateError } = await db.from('appointments').update(update).eq('id', appointment.id).eq('account_id', connectionRow.account_id)
            if (updateError) throw updateError
            await auditGoogleChange(db, connectionRow.account_id, appointment.id, 'updated_from_google', before, { ...before, ...update, google: metadata })
            summary.updated += 1
          }
        }
      } while (pageToken)
      await db.from('google_calendar_connections').update({ sync_token: nextSyncToken ?? connectionRow.sync_token, last_synced_at: new Date().toISOString(), last_error: null }).eq('id', connectionRow.id)
    } catch (error) {
      summary.failed += 1
      const message = error instanceof Error ? error.message.slice(0, 500) : 'Error desconocido al sincronizar Google Calendar.'
      const expiredToken = /(?:sync token|410|gone)/i.test(message)
      await db.from('google_calendar_connections').update({ last_error: message, ...(expiredToken ? { sync_token: null } : {}) }).eq('id', connectionRow.id)
      console.error('[appointments] Google Calendar inbound sync failed:', error)
    }
  }
  return summary
}

export async function listGoogleCalendars(accountId: string, connectionId: string) {
  const connection = await accessToken(accountId, { specialistId: null, assignedAgentId: null }, connectionId)
  if (!connection) throw new Error('No se encontró la conexión de Google Calendar.')
  const result = await googleRequest(connection.token, 'users/me/calendarList?maxResults=250') as { items?: GoogleCalendarListItem[] }
  return (result.items ?? []).map((calendar) => ({ id: calendar.id, summary: calendar.summary || calendar.id, primary: calendar.primary === true }))
}

export async function addGoogleCalendarConnection(accountId: string, sourceConnectionId: string, calendarId: string, targetSpecialistId?: string | null) {
  const db = admin()
  const { data: source, error } = await db.from('google_calendar_connections').select('id, account_id, assigned_agent_id, specialist_id, calendar_id, encrypted_access_token, encrypted_refresh_token, access_token_expires_at, sync_token').eq('id', sourceConnectionId).eq('account_id', accountId).maybeSingle<GoogleConnection>()
  if (error) throw error
  if (!source) throw new Error('No se encontró la conexión de Google Calendar.')
  const calendars = await listGoogleCalendars(accountId, sourceConnectionId)
  const calendar = calendars.find((item) => item.id === calendarId)
  if (!calendar) throw new Error('Ese calendario no pertenece a la cuenta Google conectada.')
  // A resource calendar visible from one connected Google account (e.g. a
  // clinic's shared Workspace) can be attributed to any specialist in
  // NexoOmni, not only the one that authorized the source connection.
  const targetSpecialist = targetSpecialistId !== undefined ? targetSpecialistId : source.specialist_id
  let existingQuery = db.from('google_calendar_connections').select('id').eq('account_id', accountId).eq('calendar_id', calendarId).is('assigned_agent_id', null)
  existingQuery = targetSpecialist ? existingQuery.eq('specialist_id', targetSpecialist) : existingQuery.is('specialist_id', null)
  const { data: existing, error: existingError } = await existingQuery.maybeSingle()
  if (existingError) throw existingError
  if (existing) return existing
  const { data, error: insertError } = await db.from('google_calendar_connections').insert({ account_id: accountId, assigned_agent_id: null, specialist_id: targetSpecialist, calendar_id: calendar.id, display_name: calendar.summary, is_default: false, encrypted_access_token: source.encrypted_access_token, encrypted_refresh_token: source.encrypted_refresh_token, access_token_expires_at: source.access_token_expires_at, connected_by: null, connected_at: new Date().toISOString() }).select('id').single()
  if (insertError) throw insertError
  return data
}

export async function setDefaultGoogleCalendarConnection(accountId: string, connectionId: string) {
  const db = admin()
  const { data: connection, error } = await db.from('google_calendar_connections').select('id, assigned_agent_id, specialist_id').eq('id', connectionId).eq('account_id', accountId).maybeSingle()
  if (error) throw error
  if (!connection) throw new Error('No se encontró el calendario.')
  let scope = db.from('google_calendar_connections').update({ is_default: false }).eq('account_id', accountId)
  scope = connection.assigned_agent_id ? scope.eq('assigned_agent_id', connection.assigned_agent_id) : scope.is('assigned_agent_id', null)
  scope = connection.specialist_id ? scope.eq('specialist_id', connection.specialist_id) : scope.is('specialist_id', null)
  const { error: clearError } = await scope
  if (clearError) throw clearError
  const { error: setError } = await db.from('google_calendar_connections').update({ is_default: true }).eq('id', connectionId).eq('account_id', accountId)
  if (setError) throw setError
}
