import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { requireAccountModule } from '@/lib/account/modules'
import { toErrorResponse } from '@/lib/auth/account'
import { googleAuthorizeUrl, googleCalendarConfigured } from '@/lib/appointments/google-calendar'

function admin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}
function origin(request: Request) { return (process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.APP_URL?.trim() || new URL(request.url).origin).replace(/\/$/, '') }

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireAccountModule('appointments', 'admin')
    const { data, error } = await supabase.from('google_calendar_connections').select('calendar_id, connected_at').eq('account_id', accountId).maybeSingle()
    if (error) throw error
    return NextResponse.json({ configured: googleCalendarConfigured(), connection: data ?? null })
  } catch (error) { return toErrorResponse(error) }
}

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireAccountModule('appointments', 'admin')
    if (!googleCalendarConfigured()) return NextResponse.json({ error: 'Google Calendar no está configurado en el servidor.' }, { status: 503 })
    const state = randomUUID()
    const redirectUri = `${origin(request)}/api/appointments/google/callback`
    const { error } = await admin().from('google_calendar_oauth_attempts').insert({ state, account_id: accountId, user_id: userId, redirect_uri: redirectUri, expires_at: new Date(Date.now() + 15 * 60_000).toISOString() })
    if (error) throw error
    return NextResponse.json({ authorize_url: googleAuthorizeUrl(redirectUri, state) })
  } catch (error) { return toErrorResponse(error) }
}