import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit'
import { encrypt } from '@/lib/whatsapp/encryption'
import { generateWebhookSecret, normalizeWebhookUrl } from '@/lib/webhooks/endpoints'
import { normalizeEvents, type WebhookEvent } from '@/lib/webhooks/events'
import { isDeliverableUrl } from '@/lib/webhooks/ssrf'

const SAFE_COLUMNS = 'id, name, url, events, is_active, last_delivery_at, failure_count, created_at'
const MAX_NAME_LENGTH = 80

export async function GET() {
  try {
    const ctx = await requireRole('admin')
    const { data, error } = await ctx.supabase
      .from('webhook_endpoints')
      .select(SAFE_COLUMNS)
      .eq('account_id', ctx.accountId)
      .eq('integration_type', 'n8n')
      .order('created_at', { ascending: false })

    if (error) throw error
    return NextResponse.json({ connections: data ?? [] })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`admin:n8n-connect:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const url = normalizeWebhookUrl(body?.url)
    const events = normalizeEvents(body?.events) as WebhookEvent[] | null

    if (!name || name.length > MAX_NAME_LENGTH) {
      return NextResponse.json({ error: `El nombre es obligatorio y no puede superar ${MAX_NAME_LENGTH} caracteres.` }, { status: 400 })
    }
    if (!url) {
      return NextResponse.json({ error: 'La URL de n8n debe usar HTTPS.' }, { status: 400 })
    }
    if (!events) {
      return NextResponse.json({ error: 'Selecciona al menos un evento.' }, { status: 400 })
    }
    if (!(await isDeliverableUrl(url))) {
      return NextResponse.json({ error: 'La URL debe resolver a un destino público; no se permiten hosts internos.' }, { status: 400 })
    }

    const secret = generateWebhookSecret()
    const { data, error } = await ctx.supabase
      .from('webhook_endpoints')
      .insert({
        account_id: ctx.accountId,
        created_by: ctx.userId,
        name,
        url,
        events,
        secret: encrypt(secret),
        integration_type: 'n8n',
      })
      .select(SAFE_COLUMNS)
      .single()

    if (error || !data) throw error ?? new Error('No se pudo crear la conexión.')
    return NextResponse.json({ connection: data, signing_secret: secret }, { status: 201 })
  } catch (error) {
    return toErrorResponse(error)
  }
}
