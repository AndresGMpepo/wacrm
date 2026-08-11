import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { requireEntitlement } from '@/lib/account/entitlements'
import { toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit'

const PROVIDER = 'yeastar_live_chat'

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase server configuration')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ connectorId: string }> }) {
  try {
    const { accountId, userId } = await requireEntitlement('yeastar_live_chat', 'admin')
    const limit = checkRateLimit(`omnichannel:yeastar-live-chat:manage:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { connectorId } = await params
    const body = await request.json().catch(() => null) as { action?: unknown } | null
    if (body?.action !== 'pause' && body?.action !== 'resume') {
      return NextResponse.json({ error: 'Acción de canal no válida.' }, { status: 400 })
    }

    const status = body.action === 'pause' ? 'paused' : 'configured'
    const { data, error } = await admin().from('omnichannel_connectors')
      .update({ status, last_error: null, updated_at: new Date().toISOString() })
      .eq('id', connectorId).eq('account_id', accountId).eq('provider', PROVIDER)
      .select('id, status').maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Canal Live Chat no encontrado.' }, { status: 404 })

    return NextResponse.json({
      status: data.status,
      message: body.action === 'pause'
        ? 'Canal pausado. Los eventos firmados se aceptarán sin crear conversaciones.'
        : 'Canal reactivado. Envía o prueba un mensaje desde Yeastar para confirmar la recepción.',
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ connectorId: string }> }) {
  try {
    const { accountId, userId } = await requireEntitlement('yeastar_live_chat', 'admin')
    const limit = checkRateLimit(`omnichannel:yeastar-live-chat:delete:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { connectorId } = await params
    const { error, count } = await admin().from('omnichannel_connectors')
      .delete({ count: 'exact' })
      .eq('id', connectorId).eq('account_id', accountId).eq('provider', PROVIDER)
    if (error) throw error
    if (!count) return NextResponse.json({ error: 'Canal Live Chat no encontrado.' }, { status: 404 })

    return NextResponse.json({ message: 'La integración fue eliminada de WACRM. El canal permanece intacto en Yeastar y el historial existente se conserva.' })
  } catch (error) {
    return toErrorResponse(error)
  }
}
