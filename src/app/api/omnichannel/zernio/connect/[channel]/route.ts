import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { requireEntitlement } from '@/lib/account/entitlements'
import { toErrorResponse } from '@/lib/auth/account'
import { ensureZernioProfile, getZernioConnectUrl, isZernioChannel, listZernioAccounts } from '@/lib/zernio/server'

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Falta la configuración del servidor.')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

function publicOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.APP_URL?.trim()
  if (configured && /^https:\/\//i.test(configured)) return configured.replace(/\/$/, '')
  const host = request.headers.get('x-forwarded-host')?.split(',', 1)[0]?.trim() || request.headers.get('host')
  if (host) return `${request.headers.get('x-forwarded-proto')?.split(',', 1)[0]?.trim() || 'https'}://${host}`
  throw new Error('No se pudo determinar la URL pública de NexoOmni.')
}

export async function GET(request: Request, { params }: { params: Promise<{ channel: string }> }) {
  try {
    const { channel } = await params
    if (!isZernioChannel(channel)) return NextResponse.json({ error: 'Canal no válido.' }, { status: 400 })
    const { accountId, userId, supabase } = await requireEntitlement('social_messaging', 'admin')
    const { data: account, error: accountError } = await supabase.from('accounts').select('name').eq('id', accountId).single()
    if (accountError) throw accountError
    const db = admin()
    const profileId = await ensureZernioProfile(db, accountId, account?.name ?? 'Cuenta NexoOmni', userId)
    const knownAccounts = await listZernioAccounts(profileId, channel)
    const state = randomUUID()
    const origin = publicOrigin(request)
    const callback = new URL('/api/omnichannel/zernio/callback', origin)
    callback.searchParams.set('state', state)
    const { error: attemptError } = await db.from('zernio_connection_attempts').insert({
      account_id: accountId,
      user_id: userId,
      channel,
      state,
      zernio_profile_id: profileId,
      known_account_ids: knownAccounts.map((item) => item.id),
      redirect_uri: callback.toString(),
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    })
    if (attemptError) throw attemptError
    const authUrl = await getZernioConnectUrl(channel, profileId, callback.toString())
    return NextResponse.redirect(authUrl, { status: 302 })
  } catch (error) {
    return toErrorResponse(error)
  }
}
