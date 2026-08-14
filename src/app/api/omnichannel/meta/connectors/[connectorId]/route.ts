import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { requireEntitlement } from '@/lib/account/entitlements'
import { toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit'

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase server configuration')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ connectorId: string }> }) {
  try {
    const { accountId, userId } = await requireEntitlement('social_messaging', 'admin')
    const limit = checkRateLimit(`omnichannel:meta:manage:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { connectorId } = await params
    const body = await request.json().catch(() => null) as { action?: unknown } | null
    const action = body?.action
    if (action !== 'pause' && action !== 'resume') return NextResponse.json({ error: 'Acción no válida.' }, { status: 400 })
    const { error } = await admin().from('omnichannel_connectors')
      .update({ status: action === 'pause' ? 'paused' : 'configured', last_error: null, updated_at: new Date().toISOString() })
      .eq('id', connectorId).eq('account_id', accountId).in('provider', ['facebook', 'instagram'])
    if (error) throw error
    return NextResponse.json({ message: action === 'pause' ? 'Canal pausado.' : 'Canal reactivado; Meta confirmará la conexión con el siguiente evento.' })
  } catch (error) { return toErrorResponse(error) }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ connectorId: string }> }) {
  try {
    const { accountId, userId } = await requireEntitlement('social_messaging', 'admin')
    const limit = checkRateLimit(`omnichannel:meta:delete:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { connectorId } = await params
    const { error } = await admin().from('omnichannel_connectors').delete()
      .eq('id', connectorId).eq('account_id', accountId).in('provider', ['facebook', 'instagram'])
    if (error) throw error
    return NextResponse.json({ message: 'Canal eliminado de NexoOmni. El historial permanece, pero debes borrar la suscripción también en Meta.' })
  } catch (error) { return toErrorResponse(error) }
}
