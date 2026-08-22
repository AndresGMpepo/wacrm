import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { requireEntitlement } from '@/lib/account/entitlements'
import { toErrorResponse } from '@/lib/auth/account'
import { getZernioParticipantPicture } from '@/lib/zernio/server'

const PROVIDERS = ['zernio_whatsapp', 'zernio_facebook', 'zernio_instagram']
const MAX_CONVERSATIONS_PER_SYNC = 100

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Falta la configuración del servidor.')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

type MissingAvatarConversation = {
  id: string
  contact_id: string
  external_session_id: string | null
  contacts: { avatar_url: string | null } | { avatar_url: string | null }[] | null
}

export async function POST(request: Request) {
  try {
    const { accountId } = await requireEntitlement('social_messaging', 'admin')
    const body = await request.json().catch(() => null) as { connectorId?: unknown } | null
    if (typeof body?.connectorId !== 'string' || !body.connectorId.trim()) {
      return NextResponse.json({ error: 'Selecciona una conexión válida.' }, { status: 400 })
    }

    const db = admin()
    const { data: connector, error: connectorError } = await db
      .from('omnichannel_connectors')
      .select('id, provider, zernio_account_id')
      .eq('id', body.connectorId)
      .eq('account_id', accountId)
      .in('provider', PROVIDERS)
      .maybeSingle()
    if (connectorError) throw connectorError
    if (!connector?.zernio_account_id) {
      return NextResponse.json({ error: 'La conexión no tiene una cuenta de Zernio disponible.' }, { status: 409 })
    }

    const { data, error } = await db
      .from('conversations')
      .select('id, contact_id, external_session_id, contacts!inner(avatar_url)')
      .eq('account_id', accountId)
      .eq('connector_id', connector.id)
      .is('contacts.avatar_url', null)
      .not('external_session_id', 'is', null)
      .limit(MAX_CONVERSATIONS_PER_SYNC)
    if (error) throw error

    let updated = 0
    let unavailable = 0
    for (const conversation of (data ?? []) as MissingAvatarConversation[]) {
      if (!conversation.external_session_id) continue
      const picture = await getZernioParticipantPicture(conversation.external_session_id, connector.zernio_account_id).catch(() => null)
      if (!picture) {
        unavailable += 1
        continue
      }
      const { error: updateError } = await db.from('contacts')
        .update({ avatar_url: picture })
        .eq('id', conversation.contact_id)
        .eq('account_id', accountId)
        .is('avatar_url', null)
      if (updateError) throw updateError
      updated += 1
    }

    return NextResponse.json({ updated, unavailable, scanned: data?.length ?? 0, capped: (data?.length ?? 0) === MAX_CONVERSATIONS_PER_SYNC })
  } catch (error) {
    return toErrorResponse(error)
  }
}