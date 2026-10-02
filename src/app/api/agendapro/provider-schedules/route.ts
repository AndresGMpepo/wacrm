import { NextResponse } from 'next/server'

import { requireAccountModule } from '@/lib/account/modules'
import { toErrorResponse } from '@/lib/auth/account'
import { AgendaProApiError, getAgendaProProvider } from '@/lib/agendapro/server'

/**
 * Weekly working-hours schedule for a small set of providers (the ones
 * currently shown as columns in the day view), so the calendar can
 * render "Profesional no disponible" blocks outside their real shift —
 * see getAgendaProProvider. One upstream call per provider; the caller
 * is expected to pass only the providers actually visible, not the
 * whole catalog.
 */
export async function GET(request: Request) {
  try {
    const { accountId } = await requireAccountModule('agendapro', 'agent')
    const url = new URL(request.url)
    const ids = (url.searchParams.get('provider_ids') || '')
      .split(',')
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isInteger(id) && id > 0)
      .slice(0, 30)
    if (ids.length === 0) return NextResponse.json({ schedules: {} })

    const results = await Promise.all(ids.map(async (id) => {
      try {
        const provider = await getAgendaProProvider(accountId, id)
        return [id, provider.times ?? []] as const
      } catch (error) {
        console.error(`[agendapro] could not load schedule for provider ${id}:`, error)
        return [id, []] as const
      }
    }))
    const schedules = Object.fromEntries(results)
    return NextResponse.json({ schedules })
  } catch (error) {
    if (error instanceof AgendaProApiError) return NextResponse.json({ error: error.message }, { status: 400 })
    return toErrorResponse(error)
  }
}
