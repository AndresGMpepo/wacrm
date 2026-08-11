import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { toErrorResponse } from '@/lib/auth/account'
import { requireEntitlement } from '@/lib/account/entitlements'
import { encrypt } from '@/lib/whatsapp/encryption'
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit'

const PROVIDER = 'yeastar_live_chat'
const CHANNEL_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/

function normalizeSourceUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  const sourceUrl = value.trim()
  if (sourceUrl.length > 500) throw new Error('La URL de origen excede el tamaño permitido.')
  let parsed: URL
  try {
    parsed = new URL(sourceUrl)
  } catch {
    throw new Error('Indica una URL de origen válida, incluyendo https://.')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('La URL de origen debe usar http:// o https://.')
  }
  return parsed.toString()
}

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase server configuration')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

function webhookUrl(connectorId: string) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '')
  return siteUrl ? `${siteUrl}/api/omnichannel/yeastar/events/${connectorId}` : null
}

export async function GET() {
  try {
    const { accountId } = await requireEntitlement('yeastar_live_chat', 'admin')
    const { data, error } = await admin().from('omnichannel_connectors')
      .select('id, display_name, external_channel_id, source_url, status, webhook_secret, last_event_at, last_error, created_at, updated_at')
      .eq('account_id', accountId).eq('provider', PROVIDER)
      .order('created_at', { ascending: true })
    if (error) throw error
    return NextResponse.json({
      connectors: (data ?? []).map((connector) => ({
        id: connector.id,
        displayName: connector.display_name,
        channelId: connector.external_channel_id,
        sourceUrl: connector.source_url,
        status: connector.status,
        webhookConfigured: Boolean(connector.webhook_secret),
        webhookUrl: webhookUrl(connector.id),
        lastEventAt: connector.last_event_at,
        lastError: connector.last_error,
        createdAt: connector.created_at,
        updatedAt: connector.updated_at,
      })),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireEntitlement('yeastar_live_chat', 'admin')
    const limit = checkRateLimit(`omnichannel:yeastar-live-chat:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : ''
    const channelId = typeof body?.channelId === 'string' ? body.channelId.trim() : ''
    const webhookSecret = typeof body?.webhookSecret === 'string' ? body.webhookSecret.trim() : ''
    let sourceUrl: string | null
    try {
      sourceUrl = normalizeSourceUrl(body?.sourceUrl)
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'La URL de origen no es válida.' }, { status: 400 })
    }

    if (!displayName || displayName.length > 80) {
      return NextResponse.json({ error: 'Indica un nombre de canal de hasta 80 caracteres.' }, { status: 400 })
    }
    if (!CHANNEL_ID_RE.test(channelId)) {
      return NextResponse.json({ error: 'El ID del canal Yeastar no tiene un formato válido.' }, { status: 400 })
    }
    if (webhookSecret.length > 512) {
      return NextResponse.json({ error: 'El secreto del webhook excede el tamaño permitido.' }, { status: 400 })
    }

    const db = admin()
    const { data: existing, error: existingError } = await db.from('omnichannel_connectors')
      .select('id, webhook_secret')
      .eq('account_id', accountId).eq('provider', PROVIDER).eq('external_channel_id', channelId)
      .maybeSingle()
    if (existingError) throw existingError

    const payload = {
      account_id: accountId,
      provider: PROVIDER,
      display_name: displayName,
      external_channel_id: channelId,
      source_url: sourceUrl,
      webhook_secret: webhookSecret ? encrypt(webhookSecret) : existing?.webhook_secret ?? null,
      status: 'configured',
      last_error: null,
      created_by: userId,
      updated_at: new Date().toISOString(),
    }

    const query = existing
      ? db.from('omnichannel_connectors').update(payload).eq('id', existing.id).eq('account_id', accountId)
      : db.from('omnichannel_connectors').insert(payload)
    const { data, error } = await query.select('id, display_name, external_channel_id, source_url, status, webhook_secret, last_event_at, last_error, created_at, updated_at').single()
    if (error) throw error

    return NextResponse.json({
      connector: {
        id: data.id,
        displayName: data.display_name,
        channelId: data.external_channel_id,
        sourceUrl: data.source_url,
        status: data.status,
        webhookConfigured: Boolean(data.webhook_secret),
        webhookUrl: webhookUrl(data.id),
        lastEventAt: data.last_event_at,
        lastError: data.last_error,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
      message: 'Canal Yeastar Live Chat guardado. Configura el evento 30031 en Yeastar con la URL y el secreto mostrados.',
    }, { status: existing ? 200 : 201 })
  } catch (error) {
    return toErrorResponse(error)
  }
}
