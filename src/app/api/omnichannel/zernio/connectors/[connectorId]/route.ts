import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { requireEntitlement } from '@/lib/account/entitlements'
import { toErrorResponse } from '@/lib/auth/account'
import { disconnectZernioAccount } from '@/lib/zernio/server'

const PROVIDERS = ['zernio_whatsapp', 'zernio_facebook', 'zernio_instagram']

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Falta la configuración del servidor.')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ connectorId: string }> }) {
  try {
    const { connectorId } = await params
    const { accountId } = await requireEntitlement('social_messaging', 'admin')
    const body = await request.json().catch(() => null) as { status?: string } | null
    if (body?.status !== 'paused' && body?.status !== 'configured') return NextResponse.json({ error: 'Estado no válido.' }, { status: 400 })
    const { error } = await admin().from('omnichannel_connectors')
      .update({ status: body.status, updated_at: new Date().toISOString() })
      .eq('id', connectorId).eq('account_id', accountId).in('provider', PROVIDERS)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ connectorId: string }> }) {
  try {
    const { connectorId } = await params
    const { accountId } = await requireEntitlement('social_messaging', 'admin')
    const db = admin()

    // Removing the row here without also telling Zernio leaves the
    // WhatsApp/Facebook/Instagram account connected on their side —
    // NexoOmni shows "disconnected" while Zernio (and Meta) still think
    // it's live, and a later reconnect can then collide with it.
    const { data: connector } = await db.from('omnichannel_connectors')
      .select('zernio_account_id')
      .eq('id', connectorId).eq('account_id', accountId).in('provider', PROVIDERS)
      .maybeSingle()
    let warning: string | undefined
    if (connector?.zernio_account_id) {
      const result = await disconnectZernioAccount(connector.zernio_account_id)
      if (!result.ok) {
        warning = `Se eliminó la conexión en NexoOmni, pero no se pudo confirmar la desconexión en Zernio: ${result.error}. Verifica manualmente en el panel de Zernio.`
      }
    }

    const { error } = await db.from('omnichannel_connectors')
      .delete().eq('id', connectorId).eq('account_id', accountId).in('provider', PROVIDERS)
    if (error) throw error
    return NextResponse.json({ ok: true, warning })
  } catch (error) {
    return toErrorResponse(error)
  }
}
