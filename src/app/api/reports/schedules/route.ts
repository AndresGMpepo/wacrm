import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { cleanRecipients, nextScheduleRun, type ReportScheduleFrequency } from '@/lib/reports/scheduled-reports'

export const dynamic = 'force-dynamic'

const frequencies = new Set<ReportScheduleFrequency>(['daily', 'weekly', 'monthly', 'once'])

export async function GET() {
  try {
    const ctx = await requireRole('admin')
    const { data, error } = await ctx.supabase.from('executive_report_schedules').select('id, account_id, name, enabled, frequency, scheduled_time, timezone, weekday, monthday, once_at, report_days, recipients, next_run_at, last_sent_at, last_error, created_at').eq('account_id', ctx.accountId).order('created_at', { ascending: false })
    if (error) throw error
    const { data: deliveries, error: deliveriesError } = await ctx.supabase.from('executive_report_deliveries').select('id, schedule_id, status, sent_at, error_message, created_at').eq('account_id', ctx.accountId).order('created_at', { ascending: false }).limit(12)
    if (deliveriesError) throw deliveriesError
    return NextResponse.json({ schedules: data ?? [], deliveries: deliveries ?? [] })
  } catch (error) { return toErrorResponse(error) }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = await request.json() as Record<string, unknown>
    const frequency = String(body.frequency ?? '') as ReportScheduleFrequency
    if (!frequencies.has(frequency)) return NextResponse.json({ error: 'Selecciona una frecuencia válida.' }, { status: 400 })
    const name = String(body.name ?? 'Reporte ejecutivo').trim().slice(0, 120)
    if (!name) return NextResponse.json({ error: 'Indica un nombre para el reporte.' }, { status: 400 })
    const scheduled_time = String(body.scheduled_time ?? '08:00')
    const timezone = 'America/Mexico_City'
    const weekday = frequency === 'weekly' ? Number(body.weekday) : null
    const monthday = frequency === 'monthly' ? Number(body.monthday) : null
    const rawOnceAt = frequency === 'once' ? String(body.once_at ?? '') : null
    // datetime-local omits an offset. The initial product scope uses Mexico
    // City for schedules, so normalise it explicitly instead of depending on
    // the server container's timezone.
    const once_at = rawOnceAt && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(rawOnceAt) ? `${rawOnceAt}:00-06:00` : rawOnceAt
    const report_days = Math.max(1, Math.min(365, Math.round(Number(body.report_days ?? 7))))
    const next_run_at = nextScheduleRun({ frequency, scheduled_time, timezone, weekday, monthday, once_at })
    const { data, error } = await ctx.supabase.from('executive_report_schedules').insert({ account_id: ctx.accountId, name, enabled: true, frequency, scheduled_time, timezone, weekday, monthday, once_at: once_at || null, report_days, recipients: cleanRecipients(body.recipients), next_run_at, created_by: ctx.userId }).select('id, account_id, name, enabled, frequency, scheduled_time, timezone, weekday, monthday, once_at, report_days, recipients, next_run_at, last_sent_at, last_error, created_at').single()
    if (error) throw error
    return NextResponse.json({ schedule: data }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && /Indica|Selecciona|fecha/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 })
    return toErrorResponse(error)
  }
}
