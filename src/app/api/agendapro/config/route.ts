import { NextResponse } from 'next/server'

import { requireAccountModule } from '@/lib/account/modules'
import { toErrorResponse } from '@/lib/auth/account'
import { disconnectAgendaPro, getAgendaProConfig, saveAgendaProConfig } from '@/lib/agendapro/server'

function publicOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.APP_URL?.trim()
  if (configured && /^https:\/\//i.test(configured)) return configured.replace(/\/$/, '')
  const host = request.headers.get('x-forwarded-host')?.split(',', 1)[0]?.trim() || request.headers.get('host')
  if (host) return `${request.headers.get('x-forwarded-proto')?.split(',', 1)[0]?.trim() || 'https'}://${host}`
  return ''
}

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireAccountModule('agendapro', 'admin')
    const config = await getAgendaProConfig(supabase, accountId)
    if (!config) return NextResponse.json({ connected: false })
    return NextResponse.json({
      connected: true,
      status: config.status,
      last_error: config.lastError,
      webhook_url: `${publicOrigin(request)}/api/omnichannel/agendapro/webhook/${config.webhookToken}`,
      connected_at: config.connectedAt,
    })
  } catch (error) { return toErrorResponse(error) }
}

export async function POST(request: Request) {
  try {
    const { userId, accountId } = await requireAccountModule('agendapro', 'admin')
    const body = await request.json().catch(() => null) as { api_user?: unknown; api_password?: unknown } | null
    const apiUser = typeof body?.api_user === 'string' ? body.api_user : ''
    const apiPassword = typeof body?.api_password === 'string' ? body.api_password : ''
    const webhookToken = await saveAgendaProConfig(accountId, apiUser, apiPassword, userId)
    return NextResponse.json({ connected: true, webhook_url: `${publicOrigin(request)}/api/omnichannel/agendapro/webhook/${webhookToken}` })
  } catch (error) { return toErrorResponse(error) }
}

export async function DELETE() {
  try {
    const { accountId } = await requireAccountModule('agendapro', 'admin')
    await disconnectAgendaPro(accountId)
    return NextResponse.json({ ok: true })
  } catch (error) { return toErrorResponse(error) }
}

