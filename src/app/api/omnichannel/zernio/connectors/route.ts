import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { requireEntitlement } from '@/lib/account/entitlements'
import { toErrorResponse } from '@/lib/auth/account'

const PROVIDERS = ['zernio_whatsapp', 'zernio_facebook', 'zernio_instagram']

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Falta la configuración del servidor.')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

export async function GET() {
  try {
    const { accountId } = await requireEntitlement('social_messaging', 'admin')
    const { data, error } = await admin().from('omnichannel_connectors')
      .select('id, provider, display_name, external_channel_id, status, last_event_at, last_error, created_at')
      .eq('account_id', accountId).in('provider', PROVIDERS).order('created_at', { ascending: false })
    if (error) throw error
    return NextResponse.json({
      connectors: (data ?? []).map((connector) => ({
        id: connector.id,
        provider: connector.provider,
        displayName: connector.display_name,
        externalChannelId: connector.external_channel_id,
        status: connector.status,
        lastEventAt: connector.last_event_at,
        lastError: connector.last_error,
        createdAt: connector.created_at,
      })),
      configured: Boolean(process.env.ZERNIO_API_KEY),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
