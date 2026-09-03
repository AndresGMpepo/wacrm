import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { buildAccountTrace, contactTraceCsv } from '@/lib/contacts/trace'

const MAX_DAYS = 90

/**
 * GET /api/supervision/trace  (admin+)
 *
 * Account-wide traceability for supervisors: every assignment and transfer
 * (manual, by queue or by the AI) and every call, with the agent who took
 * it. `?format=csv` downloads the same window.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const url = new URL(request.url)

    const days = Math.min(MAX_DAYS, Math.max(1, Number(url.searchParams.get('days')) || 7))
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 200))
    const since = new Date(Date.now() - days * 86_400_000).toISOString()

    let events = await buildAccountTrace(supabase, accountId, { since, limit })

    const agentId = url.searchParams.get('agent')
    if (agentId) events = events.filter((event) => event.agent_id === agentId)
    const channel = url.searchParams.get('channel')
    if (channel) events = events.filter((event) => event.channel === channel)

    if (url.searchParams.get('format') === 'csv') {
      return new NextResponse(`\uFEFF${contactTraceCsv(events)}`, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="trazabilidad-${days}d.csv"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    return NextResponse.json({ events, days })
  } catch (error) {
    return toErrorResponse(error)
  }
}
