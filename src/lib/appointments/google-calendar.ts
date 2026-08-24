import { createClient as createAdminClient } from '@supabase/supabase-js'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'

type AppointmentForGoogle = { id: string; title: string; notes: string | null; starts_at: string; ends_at: string; timezone: string; status: string; google_calendar_event_id: string | null; assigned_agent_id: string | null; contact?: { name: string | null; phone: string | null } | { name: string | null; phone: string | null }[] | null }

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
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: 'https://www.googleapis.com/auth/calendar.events', state })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export async function exchangeGoogleCode(code: string, redirectUri: string) {
  const { clientId, clientSecret } = credentials()
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }), signal: AbortSignal.timeout(10_000) })
  const data = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string }
  if (!response.ok || !data.access_token || !data.refresh_token) throw new Error(data.error_description || 'Google no devolvió los permisos de calendario requeridos.')
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString() }
}

async function accessToken(accountId: string, assignedAgentId: string | null) {
  const db = admin()
  const exact = assignedAgentId
    ? await db.from('google_calendar_connections').select('calendar_id, encrypted_access_token, encrypted_refresh_token, access_token_expires_at').eq('account_id', accountId).eq('assigned_agent_id', assignedAgentId).maybeSingle()
    : { data: null, error: null }
  if (exact.error) throw exact.error
  const fallback = exact.data ? { data: null, error: null } : await db.from('google_calendar_connections').select('calendar_id, encrypted_access_token, encrypted_refresh_token, access_token_expires_at').eq('account_id', accountId).is('assigned_agent_id', null).maybeSingle()
  const { data, error } = exact.data ? exact : fallback
  if (error) throw error
  if (!data) return null
  if (!data.access_token_expires_at || new Date(data.access_token_expires_at).getTime() > Date.now() + 60_000) return { db, calendarId: data.calendar_id, token: decrypt(data.encrypted_access_token) }
  const { clientId, clientSecret } = credentials()
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: decrypt(data.encrypted_refresh_token), grant_type: 'refresh_token' }), signal: AbortSignal.timeout(10_000) })
  const refreshed = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number }
  if (!response.ok || !refreshed.access_token) throw new Error('No se pudo renovar la conexión de Google Calendar.')
  const expiresAt = new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000).toISOString()
  await db.from('google_calendar_connections').update({ encrypted_access_token: encrypt(refreshed.access_token), access_token_expires_at: expiresAt }).eq('account_id', accountId)
  return { db, calendarId: data.calendar_id, token: refreshed.access_token }
}

function eventBody(appointment: AppointmentForGoogle) {
  const contactRow = Array.isArray(appointment.contact) ? appointment.contact[0] : appointment.contact
  const contact = contactRow?.name || contactRow?.phone
  return { summary: appointment.title, description: [appointment.notes, contact ? `Cliente: ${contact}` : null, `NexoOmni appointment: ${appointment.id}`].filter(Boolean).join('\n'), start: { dateTime: appointment.starts_at, timeZone: appointment.timezone || 'UTC' }, end: { dateTime: appointment.ends_at, timeZone: appointment.timezone || 'UTC' } }
}

export async function syncGoogleAppointment(accountId: string, appointment: AppointmentForGoogle) {
  const connection = await accessToken(accountId, appointment.assigned_agent_id)
  if (!connection) {
    await admin().from('appointments').update({ google_sync_status: 'not_connected', google_sync_error: null }).eq('id', appointment.id).eq('account_id', accountId)
    return
  }
  await connection.db.from('appointments').update({ google_sync_status: 'pending', google_sync_error: null }).eq('id', appointment.id).eq('account_id', accountId)
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(connection.calendarId)}/events`
  if (appointment.status === 'cancelled' && appointment.google_calendar_event_id) {
    const response = await fetch(`${base}/${encodeURIComponent(appointment.google_calendar_event_id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${connection.token}` }, signal: AbortSignal.timeout(10_000) })
    if (!response.ok && response.status !== 404) throw new Error('No se pudo cancelar el evento en Google Calendar.')
    await connection.db.from('appointments').update({ google_calendar_event_id: null, google_sync_status: 'synced', google_sync_error: null }).eq('id', appointment.id).eq('account_id', accountId)
    return
  }
  if (appointment.status === 'cancelled') return
  const response = await fetch(appointment.google_calendar_event_id ? `${base}/${encodeURIComponent(appointment.google_calendar_event_id)}` : base, { method: appointment.google_calendar_event_id ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(eventBody(appointment)), signal: AbortSignal.timeout(10_000) })
  const event = await response.json().catch(() => ({})) as { id?: string }
  if (!response.ok || !event.id) throw new Error('No se pudo sincronizar la cita en Google Calendar.')
  await connection.db.from('appointments').update({ google_calendar_event_id: appointment.google_calendar_event_id ?? event.id, google_sync_status: 'synced', google_sync_error: null }).eq('id', appointment.id).eq('account_id', accountId)
}