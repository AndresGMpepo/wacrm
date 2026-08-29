import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { encrypt } from '@/lib/whatsapp/encryption'
import { exchangeGoogleCode } from '@/lib/appointments/google-calendar'

function admin() { return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }) }
function redirect(request: Request, status: string, reason?: string) {
  const url = new URL('/appointments', process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.APP_URL?.trim() || request.url)
  url.searchParams.set('google', status)
  if (reason) url.searchParams.set('google_reason', reason.slice(0, 180))
  return NextResponse.redirect(url)
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const googleError = url.searchParams.get('error')
    const googleErrorDescription = url.searchParams.get('error_description')
    if (googleError) return redirect(request, 'error', googleErrorDescription || googleError)
    if (!code || !state) return redirect(request, 'error', 'Google no devolvió un código de autorización.')
    const db = admin()
    const { data: attempt, error } = await db.from('google_calendar_oauth_attempts').select('*').eq('state', state).maybeSingle()
    if (error) throw error
    if (!attempt || attempt.completed_at || new Date(attempt.expires_at).getTime() < Date.now()) return redirect(request, 'expired')
    const tokens = await exchangeGoogleCode(code, attempt.redirect_uri)
    const scopeAgent: string | null = attempt.assigned_agent_id ?? null
    // Reconnecting the same scope must refresh its tokens in place — it must
    // never delete sibling calendars added for that same doctor/responsable
    // (see addGoogleCalendarConnection), and must never collide with the
    // unique (account, calendar_id, scope) index on a second attempt.
    let existingQuery = db.from('google_calendar_connections').select('id').eq('account_id', attempt.account_id).eq('calendar_id', 'primary')
    existingQuery = scopeAgent ? existingQuery.eq('assigned_agent_id', scopeAgent) : existingQuery.is('assigned_agent_id', null)
    const { data: existing, error: existingError } = await existingQuery.maybeSingle()
    if (existingError) throw existingError
    if (existing) {
      const { error: updateError } = await db.from('google_calendar_connections').update({ encrypted_access_token: encrypt(tokens.accessToken), encrypted_refresh_token: encrypt(tokens.refreshToken), access_token_expires_at: tokens.expiresAt, connected_by: attempt.user_id, connected_at: new Date().toISOString(), last_error: null }).eq('id', existing.id)
      if (updateError) throw updateError
    } else {
      let scopeCountQuery = db.from('google_calendar_connections').select('id', { count: 'exact', head: true }).eq('account_id', attempt.account_id)
      scopeCountQuery = scopeAgent ? scopeCountQuery.eq('assigned_agent_id', scopeAgent) : scopeCountQuery.is('assigned_agent_id', null)
      const { count, error: countError } = await scopeCountQuery
      if (countError) throw countError
      const { error: connectionError } = await db.from('google_calendar_connections').insert({ account_id: attempt.account_id, assigned_agent_id: scopeAgent, calendar_id: 'primary', display_name: scopeAgent ? 'Calendario principal' : 'Calendario general', is_default: !count, encrypted_access_token: encrypt(tokens.accessToken), encrypted_refresh_token: encrypt(tokens.refreshToken), access_token_expires_at: tokens.expiresAt, connected_by: attempt.user_id, connected_at: new Date().toISOString() })
      if (connectionError) throw connectionError
    }
    await db.from('google_calendar_oauth_attempts').update({ completed_at: new Date().toISOString() }).eq('state', state)
    return redirect(request, 'connected')
  } catch (error) {
    console.error('[google-calendar] callback failed', error)
    const message = error instanceof Error ? error.message : 'No se pudo guardar la conexión de calendario.'
    return redirect(request, 'error', message)
  }
}