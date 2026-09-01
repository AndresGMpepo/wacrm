import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase server configuration')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

/**
 * GET /api/inbox/whatsapp-status
 *
 * Drives the "WhatsApp not connected" banner. `whatsapp_config` is
 * readable by any account member via RLS, but `omnichannel_connectors`
 * (the Zernio guided-connect path) is admin-only — a non-admin agent's
 * RLS-scoped client can't see it, so the banner falsely claimed
 * "not connected" for accounts connected only through Zernio. Uses the
 * service-role client to check both paths regardless of the caller's
 * role, exposing nothing beyond a boolean.
 */
export async function GET() {
  try {
    const { accountId } = await requireRole('agent')
    const db = admin()

    const [{ data: nativeConfig }, { data: zernioConnector }] = await Promise.all([
      db.from('whatsapp_config').select('status').eq('account_id', accountId).maybeSingle(),
      db.from('omnichannel_connectors').select('id').eq('account_id', accountId).eq('provider', 'zernio_whatsapp').eq('status', 'active').limit(1).maybeSingle(),
    ])

    return NextResponse.json({
      connected: nativeConfig?.status === 'connected' || Boolean(zernioConnector),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
