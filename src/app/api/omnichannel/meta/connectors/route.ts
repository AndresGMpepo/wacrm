import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { requireEntitlement } from '@/lib/account/entitlements'
import { toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit'

const PROVIDERS = ['facebook', 'instagram'] as const
type Provider = (typeof PROVIDERS)[number]
const CHANNEL_ID_RE = /^[0-9]{3,64}$/

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase server configuration')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

function publicOrigin(request: Request) {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',', 1)[0]?.trim()
  if (forwardedHost) {
    const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',', 1)[0]?.trim() || 'https'
    return `${forwardedProto}://${forwardedHost}`
  }
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (configured) return configured.replace(/\/$/, '')
  return new URL(request.url).origin
}

function asProvider(value: unknown): Provider | null {
  return typeof value === 'string' && (PROVIDERS as readonly string[]).includes(value) ? value as Provider : null
}

function exposedConnector(request: Request, connector: Record<string, unknown>) {
  return {
    id: connector.id,
    provider: connector.provider,
    displayName: connector.display_name,
    channelId: connector.external_channel_id,
    status: connector.status,
    webhookConfigured: Boolean(connector.meta_verify_token && connector.meta_app_secret),
    outboundConfigured: Boolean(connector.meta_access_token),
    webhookUrl: `${publicOrigin(request)}/api/omnichannel/meta/webhook`,
    lastEventAt: connector.last_event_at,
    lastError: connector.last_error,
  }
}

export async function GET(request: Request) {
  try {
    const { accountId } = await requireEntitlement('social_messaging', 'admin')
    const { data, error } = await admin().from('omnichannel_connectors')
      .select('id, provider, display_name, external_channel_id, status, meta_access_token, meta_app_secret, meta_verify_token, last_event_at, last_error')
      .eq('account_id', accountId).in('provider', [...PROVIDERS]).order('created_at')
    if (error) throw error
    return NextResponse.json({ connectors: (data ?? []).map((connector) => exposedConnector(request, connector)) })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireEntitlement('social_messaging', 'admin')
    const limit = checkRateLimit(`omnichannel:meta:configure:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const provider = asProvider(body?.provider)
    const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : ''
    const channelId = typeof body?.channelId === 'string' ? body.channelId.trim() : ''
    const accessToken = typeof body?.accessToken === 'string' ? body.accessToken.trim() : ''
    const appSecret = typeof body?.appSecret === 'string' ? body.appSecret.trim() : ''
    const verifyToken = typeof body?.verifyToken === 'string' ? body.verifyToken.trim() : ''
    if (!provider) return NextResponse.json({ error: 'Selecciona Facebook o Instagram.' }, { status: 400 })
    if (!displayName || displayName.length > 80) return NextResponse.json({ error: 'Indica un nombre de canal de hasta 80 caracteres.' }, { status: 400 })
    if (!CHANNEL_ID_RE.test(channelId)) return NextResponse.json({ error: 'El ID de página o cuenta profesional de Meta no es válido.' }, { status: 400 })
    if (accessToken.length > 2048 || appSecret.length > 512 || verifyToken.length > 512) return NextResponse.json({ error: 'Una credencial excede el tamaño permitido.' }, { status: 400 })

    const db = admin()
    const { data: existing, error: existingError } = await db.from('omnichannel_connectors')
      .select('id, meta_access_token, meta_app_secret, meta_verify_token, status')
      .eq('account_id', accountId).eq('provider', provider).eq('external_channel_id', channelId).maybeSingle()
    if (existingError) throw existingError
    if (!existing && (!accessToken || !appSecret || !verifyToken)) {
      return NextResponse.json({ error: 'Para un canal nuevo captura el token de acceso, App Secret y token de verificación.' }, { status: 400 })
    }

    const payload = {
      account_id: accountId,
      provider,
      display_name: displayName,
      external_channel_id: channelId,
      meta_access_token: accessToken ? encrypt(accessToken) : existing?.meta_access_token ?? null,
      meta_app_secret: appSecret ? encrypt(appSecret) : existing?.meta_app_secret ?? null,
      meta_verify_token: verifyToken ? encrypt(verifyToken) : existing?.meta_verify_token ?? null,
      status: existing?.status ?? 'configured',
      last_error: null,
      created_by: userId,
      updated_at: new Date().toISOString(),
    }
    const query = existing
      ? db.from('omnichannel_connectors').update(payload).eq('id', existing.id).eq('account_id', accountId)
      : db.from('omnichannel_connectors').insert(payload)
    const { data, error } = await query.select('id, provider, display_name, external_channel_id, status, meta_access_token, meta_app_secret, meta_verify_token, last_event_at, last_error').single()
    if (error) throw error
    return NextResponse.json({ connector: exposedConnector(request, data), message: 'Canal Meta guardado. Suscribe esta URL en tu App de Meta y usa el mismo token de verificación.' }, { status: existing ? 200 : 201 })
  } catch (error) {
    return toErrorResponse(error)
  }
}
