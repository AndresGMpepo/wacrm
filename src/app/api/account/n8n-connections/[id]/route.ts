import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import { buildSignatureHeader } from '@/lib/webhooks/sign'
import { isDeliverableUrl } from '@/lib/webhooks/ssrf'

type Params = { params: Promise<{ id: string }> }

/**
 * Sends a harmless, signed request to the production n8n Webhook URL.
 * This intentionally does not use a business event: testing a connection
 * must never create a deal, send a customer message or run an automation.
 */
export async function POST(_: Request, { params }: Params) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`admin:n8n-connection-test:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await params
    const { data: connection, error } = await ctx.supabase
      .from('webhook_endpoints')
      .select('id, name, url, secret, is_active')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .eq('integration_type', 'n8n')
      .maybeSingle()

    if (error) throw error
    if (!connection) return NextResponse.json({ error: 'No se encontró esta conexión n8n.' }, { status: 404 })
    if (!connection.is_active) return NextResponse.json({ error: 'Reactiva la conexión antes de probarla.' }, { status: 409 })
    if (!(await isDeliverableUrl(connection.url))) {
      return NextResponse.json({ error: 'La URL ya no resuelve a un destino HTTPS público.' }, { status: 422 })
    }

    let secret: string
    try {
      secret = decrypt(connection.secret)
    } catch {
      return NextResponse.json({ error: 'No se pudo leer de forma segura el secreto de esta conexión.' }, { status: 503 })
    }

    const payload = JSON.stringify({
      id: randomUUID(),
      event: 'nexoomni.connection_test',
      occurred_at: new Date().toISOString(),
      account_id: ctx.accountId,
      data: { connection_id: connection.id, connection_name: connection.name, test: true },
    })
    const timestamp = Math.floor(Date.now() / 1000)
    const response = await fetch(connection.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-NexoOmni-Event': 'nexoomni.connection_test',
        'X-NexoOmni-Webhook-Id': connection.id,
        'X-NexoOmni-Signature': buildSignatureHeader(payload, secret, timestamp),
        'X-Wacrm-Event': 'nexoomni.connection_test',
        'X-Wacrm-Webhook-Id': connection.id,
        'X-Wacrm-Signature': buildSignatureHeader(payload, secret, timestamp),
        'X-NexoOmni-Test': 'true',
      },
      body: payload,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      return NextResponse.json({ error: `n8n respondió HTTP ${response.status}. Verifica que uses la URL de producción y que el flujo esté activo.` }, { status: 502 })
    }

    const { error: updateError } = await ctx.supabase
      .from('webhook_endpoints')
      .update({ failure_count: 0, last_delivery_at: new Date().toISOString() })
      .eq('id', connection.id)
      .eq('account_id', ctx.accountId)
    if (updateError) throw updateError

    return NextResponse.json({ message: 'Conexión n8n validada. Se envió un evento de prueba firmado; no ejecutó ninguna acción comercial.' })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return NextResponse.json({ error: 'n8n tardó más de 10 segundos en responder. Revisa la URL, el flujo activo y su respuesta Webhook.' }, { status: 504 })
    }
    return toErrorResponse(error)
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`admin:n8n-connection-update:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await params
    const body = await request.json().catch(() => null) as { is_active?: unknown } | null
    if (typeof body?.is_active !== 'boolean') {
      return NextResponse.json({ error: 'is_active debe ser booleano.' }, { status: 400 })
    }

    const updates = body.is_active
      ? { is_active: true, failure_count: 0 }
      : { is_active: false }
    const { error } = await ctx.supabase
      .from('webhook_endpoints')
      .update(updates)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .eq('integration_type', 'n8n')
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(_: Request, { params }: Params) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`admin:n8n-connection-delete:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await params
    const { error } = await ctx.supabase
      .from('webhook_endpoints')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .eq('integration_type', 'n8n')
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
