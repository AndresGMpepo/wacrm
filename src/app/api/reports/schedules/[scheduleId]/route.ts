import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit'
import { nextScheduleRun, type ReportSchedule, type ReportScheduleFrequency } from '@/lib/reports/scheduled-reports'

export const dynamic = 'force-dynamic'

type ScheduleContext = { params: Promise<{ scheduleId: string }> }

export async function PATCH(request: Request, context: ScheduleContext) {
  try {
    const ctx = await requireRole('admin')
    const { scheduleId } = await context.params
    const body = await request.json() as { enabled?: boolean }
    if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'Actualización no válida.' }, { status: 400 })
    const patch: Record<string, unknown> = { enabled: body.enabled, last_error: null }
    if (body.enabled) {
      const { data: schedule, error } = await ctx.supabase.from('executive_report_schedules').select('id, account_id, name, enabled, frequency, scheduled_time, timezone, weekday, monthday, once_at, report_days, recipients, next_run_at, last_sent_at, last_error, created_at').eq('id', scheduleId).eq('account_id', ctx.accountId).single()
      if (error) throw error
      patch.next_run_at = nextScheduleRun(schedule as ReportSchedule & { frequency: ReportScheduleFrequency })
    }
    const { data, error } = await ctx.supabase.from('executive_report_schedules').update(patch).eq('id', scheduleId).eq('account_id', ctx.accountId).select('id, account_id, name, enabled, frequency, scheduled_time, timezone, weekday, monthday, once_at, report_days, recipients, next_run_at, last_sent_at, last_error, created_at').single()
    if (error) throw error
    return NextResponse.json({ schedule: data })
  } catch (error) { return toErrorResponse(error) }
}

// A controlled diagnostic action for account administrators. It uses the
// exact same protected worker and SMTP path as scheduled delivery, but marks
// only this account's selected schedule as due now. That gives the UI an
// immediate delivery/error record instead of silently waiting for the minute
// worker when email configuration is incomplete.
export async function POST(request: Request, context: ScheduleContext) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`reports:schedule-send-now:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { scheduleId } = await context.params
    const body = await request.json().catch(() => null) as { action?: unknown } | null
    if (body?.action !== 'send_now') return NextResponse.json({ error: 'Acción no válida.' }, { status: 400 })

    const { data: schedule, error: scheduleError } = await ctx.supabase
      .from('executive_report_schedules')
      .update({ enabled: true, next_run_at: new Date().toISOString(), last_error: null })
      .eq('id', scheduleId)
      .eq('account_id', ctx.accountId)
      .select('id')
      .maybeSingle()
    if (scheduleError) throw scheduleError
    if (!schedule) return NextResponse.json({ error: 'No se encontró la programación.' }, { status: 404 })

    const workerSecret = process.env.AI_ANALYSIS_WORKER_SECRET
    if (!workerSecret) return NextResponse.json({ error: 'El worker de reportes no está configurado.' }, { status: 503 })

    const workerUrl = new URL('/api/internal/report-schedule-worker', request.url)
    const workerResponse = await fetch(workerUrl, {
      method: 'POST',
      headers: { 'x-ai-worker-secret': workerSecret },
      cache: 'no-store',
    })
    const payload = await workerResponse.json().catch(() => null) as { sent?: number; failed?: number; error?: string } | null
    if (!workerResponse.ok) return NextResponse.json({ error: payload?.error ?? 'No se pudo ejecutar el worker de reportes.' }, { status: 502 })
    return NextResponse.json({ sent: payload?.sent ?? 0, failed: payload?.failed ?? 0, error: payload?.error })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(_request: Request, context: ScheduleContext) {
  try {
    const ctx = await requireRole('admin')
    const { scheduleId } = await context.params
    const { error } = await ctx.supabase.from('executive_report_schedules').delete().eq('id', scheduleId).eq('account_id', ctx.accountId)
    if (error) throw error
    return new NextResponse(null, { status: 204 })
  } catch (error) { return toErrorResponse(error) }
}
