import { NextResponse } from 'next/server'

import { requireAccountModule } from '@/lib/account/modules'
import { toErrorResponse } from '@/lib/auth/account'
import { getAgendaProConfig, getAgendaProTimezone, saveAgendaProTimezone } from '@/lib/agendapro/server'

/**
 * The IANA timezone AgendaPro's own locations operate in — see
 * src/lib/agendapro/time.ts for why this needs to be configurable at
 * all (AgendaPro's API mislabels local time as UTC, so correcting it
 * needs to know the real zone).
 */

export async function GET() {
  try {
    const { supabase, accountId } = await requireAccountModule('agendapro', 'admin')
    const config = await getAgendaProConfig(supabase, accountId)
    if (!config) return NextResponse.json({ error: 'Conecta AgendaPro primero.' }, { status: 404 })
    const timezone = await getAgendaProTimezone(supabase, accountId)
    return NextResponse.json({ timezone })
  } catch (error) { return toErrorResponse(error) }
}

export async function POST(request: Request) {
  try {
    const { accountId } = await requireAccountModule('agendapro', 'admin')
    const body = await request.json().catch(() => null) as { timezone?: unknown } | null
    const timezone = typeof body?.timezone === 'string' ? body.timezone.trim() : ''
    if (!timezone) return NextResponse.json({ error: 'Falta la zona horaria.' }, { status: 400 })
    try {
      await saveAgendaProTimezone(accountId, timezone)
    } catch (validationError) {
      // A bad IANA zone is a 400 (caller's mistake), not a 500 — kept out
      // of toErrorResponse's generic-error path below, which collapses
      // any plain Error into an opaque "Internal server error".
      return NextResponse.json({ error: validationError instanceof Error ? validationError.message : 'Zona horaria inválida.' }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) { return toErrorResponse(error) }
}
