import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type ReportScheduleFrequency = 'daily' | 'weekly' | 'monthly' | 'once'
export type ReportSchedule = {
  id: string; account_id: string; name: string; enabled: boolean; frequency: ReportScheduleFrequency
  scheduled_time: string; timezone: string; weekday: number | null; monthday: number | null
  once_at: string | null; report_days: number; recipients: string[]; next_run_at: string
  last_sent_at: string | null; last_error: string | null; created_at: string
}

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function reportAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase server configuration')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

function localParts(date: Date, timezone: string): LocalParts {
  const values = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  const value = (type: string) => Number(values.find((item) => item.type === type)?.value ?? 0)
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute') }
}

function localAsUtc(parts: LocalParts) { return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) }

function zonedUtc(parts: LocalParts, timezone: string) {
  let guess = localAsUtc(parts)
  for (let index = 0; index < 3; index += 1) guess += localAsUtc(parts) - localAsUtc(localParts(new Date(guess), timezone))
  return new Date(guess)
}

function parseTime(value: string) {
  const match = /^(\d{2}):(\d{2})/.exec(value)
  if (!match) throw new Error('Indica una hora válida.')
  const hour = Number(match[1]); const minute = Number(match[2])
  if (hour > 23 || minute > 59) throw new Error('Indica una hora válida.')
  return { hour, minute }
}

export function cleanRecipients(value: unknown) {
  const list = (Array.isArray(value) ? value : []).map((item) => String(item).trim().toLowerCase()).filter(Boolean)
  const unique = [...new Set(list)]
  if (!unique.length || unique.length > 10 || unique.some((email) => !EMAIL_RE.test(email))) throw new Error('Indica entre 1 y 10 correos válidos.')
  return unique
}

export function nextScheduleRun(input: Pick<ReportSchedule, 'frequency' | 'scheduled_time' | 'timezone' | 'weekday' | 'monthday' | 'once_at'>, now = new Date()) {
  if (input.frequency === 'once') {
    if (!input.once_at || Number.isNaN(new Date(input.once_at).getTime())) throw new Error('Indica una fecha y hora para el envío único.')
    const target = new Date(input.once_at)
    if (target <= now) throw new Error('La fecha del envío único debe ser futura.')
    return target.toISOString()
  }
  const timezone = input.timezone || 'America/Mexico_City'
  const time = parseTime(input.scheduled_time)
  const current = localParts(now, timezone)
  const candidate = new Date(Date.UTC(current.year, current.month - 1, current.day, time.hour, time.minute))
  const currentLocal = localAsUtc(current)
  if (input.frequency === 'weekly') {
    if (input.weekday === null || input.weekday < 0 || input.weekday > 6) throw new Error('Selecciona el día semanal.')
    const currentWeekday = new Date(Date.UTC(current.year, current.month - 1, current.day)).getUTCDay()
    let offset = input.weekday - currentWeekday
    if (offset < 0 || (offset === 0 && candidate.getTime() <= currentLocal)) offset += 7
    candidate.setUTCDate(candidate.getUTCDate() + offset)
  } else if (input.frequency === 'monthly') {
    if (input.monthday === null || input.monthday < 1 || input.monthday > 31) throw new Error('Indica el día mensual.')
    const maxDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()
    candidate.setUTCDate(Math.min(input.monthday, maxDay(current.year, current.month)))
    if (candidate.getTime() <= currentLocal) {
      candidate.setUTCMonth(candidate.getUTCMonth() + 1, 1)
      candidate.setUTCDate(Math.min(input.monthday, maxDay(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1)))
    }
  } else if (candidate.getTime() <= currentLocal) candidate.setUTCDate(candidate.getUTCDate() + 1)
  return zonedUtc({ year: candidate.getUTCFullYear(), month: candidate.getUTCMonth() + 1, day: candidate.getUTCDate(), hour: time.hour, minute: time.minute }, timezone).toISOString()
}

export function nextAfterDelivery(schedule: ReportSchedule) {
  if (schedule.frequency === 'once') return null
  return nextScheduleRun(schedule, new Date(new Date(schedule.next_run_at).getTime() + 60_000))
}

export async function sendScheduledReportEmail({ to, subject, html, csv, xls }: { to: string[]; subject: string; html: string; csv: string; xls: string }) {
  const key = process.env.RESEND_API_KEY
  const from = process.env.REPORTS_EMAIL_FROM
  if (!key || !from) throw new Error('Falta configurar RESEND_API_KEY o REPORTS_EMAIL_FROM para enviar reportes.')
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from, to, subject, html,
      attachments: [
        { filename: 'nexoomni-reporte-ejecutivo.csv', content: Buffer.from(csv).toString('base64') },
        { filename: 'nexoomni-reporte-ejecutivo.xls', content: Buffer.from(xls).toString('base64') },
      ],
    }),
  })
  const payload = await response.json().catch(() => null) as { id?: string; message?: string } | null
  if (!response.ok) throw new Error(payload?.message || `El proveedor de correo devolvió HTTP ${response.status}.`)
  return payload?.id ?? null
}

export type ReportDb = SupabaseClient
