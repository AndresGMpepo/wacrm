import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { agentPerformanceCsv, buildAgentPerformance } from '@/lib/supervision/performance'

const MAX_DAYS = 90

/**
 * GET /api/supervision/performance  (admin+)
 *
 * Per-agent workload for the window: messages sent, conversations handled
 * and closed, transfers in and out, calls, notes, appointments and tags.
 * `?format=csv` downloads the same table.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const url = new URL(request.url)
    const days = Math.min(MAX_DAYS, Math.max(1, Number(url.searchParams.get('days')) || 7))
    const since = new Date(Date.now() - days * 86_400_000).toISOString()

    const rows = await buildAgentPerformance(supabase, accountId, since)

    if (url.searchParams.get('format') === 'csv') {
      return new NextResponse(`\uFEFF${agentPerformanceCsv(rows)}`, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="desempeno-agentes-${days}d.csv"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    return NextResponse.json({ rows, days })
  } catch (error) {
    return toErrorResponse(error)
  }
}
