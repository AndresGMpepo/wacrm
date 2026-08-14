import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { requireEntitlement } from '@/lib/account/entitlements'
import { toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase server configuration')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

function graphVersion() {
  const configured = process.env.META_GRAPH_API_VERSION?.trim()
  return /^v\d+\.\d+$/.test(configured ?? '') ? configured as string : 'v22.0'
}

function metaError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback
  const error = (payload as { error?: { message?: unknown } }).error
  return typeof error?.message === 'string' && error.message.trim() ? error.message.trim().slice(0, 300) : fallback
}

export async function POST(_request: Request, { params }: { params: Promise<{ connectorId: string }> }) {
  try {
    const { accountId, userId } = await requireEntitlement('social_messaging', 'admin')
    const limit = checkRateLimit(`omnichannel:meta:validate:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { connectorId } = await params
    const db = admin()
    const { data: connector, error } = await db.from('omnichannel_connectors')
      .select('id, provider, display_name, external_channel_id, meta_access_token, status')
      .eq('id', connectorId).eq('account_id', accountId).in('provider', ['facebook', 'instagram']).maybeSingle()
    if (error) throw error
    if (!connector) return NextResponse.json({ error: 'No se encontró este canal Meta.' }, { status: 404 })
    if (connector.status === 'paused') return NextResponse.json({ error: 'Reactiva el canal antes de validarlo.' }, { status: 409 })
    if (!connector.meta_access_token) return NextResponse.json({ error: 'Falta el token de acceso de Meta.' }, { status: 409 })

    let accessToken: string
    try { accessToken = decrypt(connector.meta_access_token) } catch { return NextResponse.json({ error: 'No se pudo leer de forma segura el token de este canal.' }, { status: 503 }) }
    const response = await fetch(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(connector.external_channel_id)}?fields=id,name`, {
      headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000), cache: 'no-store',
    })
    const payload = await response.json().catch(() => null) as { id?: unknown; name?: unknown } | null
    if (!response.ok || String(payload?.id ?? '') !== connector.external_channel_id) {
      const detail = metaError(payload, `HTTP ${response.status}`)
      await db.from('omnichannel_connectors').update({ status: 'error', last_error: `Validación Meta: ${detail}`, updated_at: new Date().toISOString() }).eq('id', connector.id)
      return NextResponse.json({ error: `Meta no validó el canal: ${detail}` }, { status: 422 })
    }
    await db.from('omnichannel_connectors').update({ status: 'active', last_error: null, updated_at: new Date().toISOString() }).eq('id', connector.id)
    const label = typeof payload?.name === 'string' && payload.name.trim() ? ` (${payload.name.trim()})` : ''
    return NextResponse.json({ message: `Conexión con Meta validada${label}. Falta recibir el primer mensaje o comentario para confirmar el webhook.` })
  } catch (error) { return toErrorResponse(error) }
}
