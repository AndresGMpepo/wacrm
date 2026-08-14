import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { requireEntitlement } from '@/lib/account/entitlements'
import { toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

type GraphObject = {
  id?: unknown
  name?: unknown
  username?: unknown
  error?: { message?: unknown }
  data?: Array<{ id?: unknown; name?: unknown; username?: unknown }>
}

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase server configuration')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

function graphVersion() {
  const configured = process.env.META_GRAPH_API_VERSION?.trim()
  return /^v\d+\.\d+$/.test(configured ?? '') ? configured : 'v22.0'
}

async function graphGet(path: string, accessToken: string) {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}${path}`)
  // Meta accepts bearer authentication, keeping the credential out of the URL and logs.
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => null) as GraphObject | null
  return { response, payload }
}

function graphError(payload: GraphObject | null, fallback: string) {
  const message = payload?.error?.message
  return typeof message === 'string' && message.trim() ? message.trim().slice(0, 300) : fallback
}

function graphLabel(item: { id?: unknown; name?: unknown; username?: unknown }) {
  const id = typeof item.id === 'string' ? item.id : ''
  const name = typeof item.name === 'string' ? item.name : typeof item.username === 'string' ? item.username : ''
  return id && name ? `${name} (${id})` : id || name
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
      .eq('id', connectorId)
      .eq('account_id', accountId)
      .in('provider', ['facebook', 'instagram'])
      .maybeSingle()

    if (error) throw error
    if (!connector) return NextResponse.json({ error: 'No se encontró este canal Meta.' }, { status: 404 })
    if (connector.status === 'paused') return NextResponse.json({ error: 'Reactiva el canal antes de validarlo.' }, { status: 409 })
    if (!connector.meta_access_token) return NextResponse.json({ error: 'Falta el token de acceso de Meta.' }, { status: 409 })

    let accessToken: string
    try {
      accessToken = decrypt(connector.meta_access_token)
    } catch {
      return NextResponse.json({ error: 'No se pudo leer de forma segura el token de este canal.' }, { status: 503 })
    }

    const target = await graphGet(`/${encodeURIComponent(connector.external_channel_id)}?fields=id,name,username`, accessToken)
    const matchesTarget = target.response.ok && String(target.payload?.id ?? '') === connector.external_channel_id
    if (!matchesTarget) {
      // A second request tells the administrator if the credential itself is bad,
      // versus a valid credential that simply cannot administer the configured Page/IG account.
      const tokenOwner = await graphGet('/me?fields=id,name,username', accessToken)
      const tokenIsValid = tokenOwner.response.ok && Boolean(tokenOwner.payload?.id)
      let available: string[] = []

      if (tokenIsValid && connector.provider === 'facebook') {
        const pages = await graphGet('/me/accounts?fields=id,name&limit=25', accessToken)
        if (pages.response.ok && Array.isArray(pages.payload?.data)) {
          available = pages.payload.data.map(graphLabel).filter(Boolean).slice(0, 10)
        }
      }

      const detail = graphError(target.payload, `HTTP ${target.response.status}`)
      const storedError = tokenIsValid
        ? 'El token es válido, pero no permite acceder al ID configurado. Revisa que sea el ID de la Página/cuenta profesional y usa su token de acceso.'
        : `El token de Meta no pudo validarse: ${detail}`
      await db.from('omnichannel_connectors')
        .update({ status: 'error', last_error: storedError.slice(0, 500), updated_at: new Date().toISOString() })
        .eq('id', connector.id)

      const guidance = tokenIsValid
        ? `El token es válido, pero no tiene acceso al ID ${connector.external_channel_id}. Usa el ID real de la Página de Facebook o cuenta profesional de Instagram y un Page/Instagram access token de esa misma cuenta.`
        : `Meta rechazó el token o no pudo comprobarlo: ${detail}`
      const availableHint = available.length ? ` Páginas disponibles para este token: ${available.join(', ')}.` : ''
      return NextResponse.json({ error: `${guidance}${availableHint}`, availableChannels: available }, { status: 422 })
    }

    await db.from('omnichannel_connectors')
      .update({ status: 'active', last_error: null, updated_at: new Date().toISOString() })
      .eq('id', connector.id)
    const label = graphLabel(target.payload ?? {})
    return NextResponse.json({ message: `Conexión con Meta validada${label ? ` (${label})` : ''}. Falta recibir el primer mensaje o comentario para confirmar el webhook.` })
  } catch (error) {
    return toErrorResponse(error)
  }
}
