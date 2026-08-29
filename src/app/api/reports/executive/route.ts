import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { buildExecutiveReport, computeRange } from '@/lib/reports/build-executive-report'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const workerAllowed = Boolean(process.env.AI_ANALYSIS_WORKER_SECRET) && request.headers.get('x-report-worker-secret') === process.env.AI_ANALYSIS_WORKER_SECRET
    const ctx = workerAllowed ? null : await requireRole('admin')
    const accountId = workerAllowed ? url.searchParams.get('account_id') : ctx!.accountId
    if (!accountId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(accountId)) {
      return NextResponse.json({ error: 'Cuenta de reporte no válida.' }, { status: 400 })
    }
    const range = computeRange(url.searchParams.get('from'), url.searchParams.get('to'))
    const report = await buildExecutiveReport(accountId, range)
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('El periodo')) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return toErrorResponse(error)
  }
}
