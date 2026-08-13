import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
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

export async function DELETE(_request: Request, context: ScheduleContext) {
  try {
    const ctx = await requireRole('admin')
    const { scheduleId } = await context.params
    const { error } = await ctx.supabase.from('executive_report_schedules').delete().eq('id', scheduleId).eq('account_id', ctx.accountId)
    if (error) throw error
    return new NextResponse(null, { status: 204 })
  } catch (error) { return toErrorResponse(error) }
}
