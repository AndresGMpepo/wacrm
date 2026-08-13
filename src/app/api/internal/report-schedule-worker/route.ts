import { NextResponse } from 'next/server'

import { executiveReportCsv, executiveReportExcelXml, type ExecutiveReport } from '@/lib/reports/executive-report-export'
import { nextAfterDelivery, reportAdmin, sendScheduledReportEmail, type ReportSchedule } from '@/lib/reports/scheduled-reports'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function dateOffset(days: number) { const date = new Date(); date.setUTCDate(date.getUTCDate() - days + 1); return date.toISOString().slice(0, 10) }
function today() { return new Date().toISOString().slice(0, 10) }
function displayMode(mode: ExecutiveReport['meta']['operating_mode']) { return mode === 'commercial' ? 'Comercial' : mode === 'support' ? 'Soporte' : 'Híbrido' }
function mailHtml(report: ExecutiveReport) {
  const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: report.meta.currency, maximumFractionDigits: 0 }).format(report.commercial.open_pipeline_value)
  return `<main style="font-family:Arial,sans-serif;color:#172033;max-width:680px;margin:auto"><h1>NexoOmni · Reporte ejecutivo</h1><p>Periodo: <strong>${report.meta.range.from} al ${report.meta.range.to}</strong> · Perfil ${displayMode(report.meta.operating_mode)}</p><table style="border-collapse:collapse;width:100%"><tbody><tr><td style="padding:8px;border:1px solid #d8dee9">Conversaciones nuevas</td><td style="padding:8px;border:1px solid #d8dee9"><strong>${report.operational.new_conversations}</strong></td></tr><tr><td style="padding:8px;border:1px solid #d8dee9">Cola abierta</td><td style="padding:8px;border:1px solid #d8dee9"><strong>${report.operational.open_backlog}</strong></td></tr><tr><td style="padding:8px;border:1px solid #d8dee9">Sentimiento negativo</td><td style="padding:8px;border:1px solid #d8dee9"><strong>${report.intelligence.negative_rate ?? 'Sin datos'}%</strong></td></tr><tr><td style="padding:8px;border:1px solid #d8dee9">Pipeline abierto</td><td style="padding:8px;border:1px solid #d8dee9"><strong>${money}</strong></td></tr></tbody></table><p style="color:#536075">Se adjuntan los archivos CSV y Excel con el detalle. Este correo fue generado automáticamente por NexoOmni.</p></main>`
}

export async function POST(request: Request) {
  if (!process.env.AI_ANALYSIS_WORKER_SECRET || request.headers.get('x-ai-worker-secret') !== process.env.AI_ANALYSIS_WORKER_SECRET) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = reportAdmin(); const now = new Date()
  const { data: schedules, error } = await db.from('executive_report_schedules').select('id, account_id, name, enabled, frequency, scheduled_time, timezone, weekday, monthday, once_at, report_days, recipients, next_run_at, last_sent_at, last_error, created_at').eq('enabled', true).lte('next_run_at', now.toISOString()).order('next_run_at').limit(5)
  if (error) return NextResponse.json({ error: 'Could not load report schedules' }, { status: 500 })
  let sent = 0; let failed = 0
  for (const schedule of (schedules ?? []) as ReportSchedule[]) {
    const scheduledFor = schedule.next_run_at
    const { data: claim } = await db.from('executive_report_schedules').update({ next_run_at: new Date(now.getTime() + 10 * 60_000).toISOString() }).eq('id', schedule.id).eq('next_run_at', scheduledFor).select('id').maybeSingle()
    if (!claim) continue
    try {
      const baseUrl = process.env.APP_URL?.replace(/\/$/, '')
      if (!baseUrl) throw new Error('Falta APP_URL para generar el reporte programado.')
      const reportResponse = await fetch(`${baseUrl}/api/reports/executive?account_id=${encodeURIComponent(schedule.account_id)}&from=${dateOffset(schedule.report_days)}&to=${today()}`, { headers: { 'x-report-worker-secret': process.env.AI_ANALYSIS_WORKER_SECRET } })
      const report = await reportResponse.json().catch(() => null) as ExecutiveReport | { error?: string } | null
      if (!reportResponse.ok || !report || !('meta' in report)) throw new Error((report as { error?: string } | null)?.error ?? 'No se pudo generar el reporte.')
      const payload = report as ExecutiveReport
      const messageId = await sendScheduledReportEmail({ to: schedule.recipients, subject: `NexoOmni · ${schedule.name} · ${payload.meta.range.from} al ${payload.meta.range.to}`, html: mailHtml(payload), csv: executiveReportCsv(payload), xls: executiveReportExcelXml(payload) })
      await db.from('executive_report_deliveries').insert({ account_id: schedule.account_id, schedule_id: schedule.id, scheduled_for: scheduledFor, range_from: payload.meta.range.from, range_to: payload.meta.range.to, recipients: schedule.recipients, status: 'sent', provider_message_id: messageId, sent_at: new Date().toISOString() })
      await db.from('executive_report_schedules').update({ next_run_at: nextAfterDelivery(schedule), last_sent_at: new Date().toISOString(), last_error: null, enabled: schedule.frequency === 'once' ? false : true }).eq('id', schedule.id)
      sent++
    } catch (cause) {
      const message = cause instanceof Error ? cause.message.slice(0, 500) : 'Error desconocido'
      await db.from('executive_report_deliveries').insert({ account_id: schedule.account_id, schedule_id: schedule.id, scheduled_for: scheduledFor, range_from: dateOffset(schedule.report_days), range_to: today(), recipients: schedule.recipients, status: 'failed', error_message: message })
      await db.from('executive_report_schedules').update({ next_run_at: nextAfterDelivery(schedule), last_error: message, enabled: schedule.frequency === 'once' ? false : true }).eq('id', schedule.id)
      failed++
    }
  }
  return NextResponse.json({ sent, failed })
}
