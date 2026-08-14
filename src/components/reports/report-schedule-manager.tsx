'use client'

import { useEffect, useState } from 'react'
import { CalendarClock, CirclePause, CirclePlay, Loader2, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Frequency = 'daily' | 'weekly' | 'monthly' | 'once'
type Schedule = { id: string; name: string; enabled: boolean; frequency: Frequency; scheduled_time: string; weekday: number | null; monthday: number | null; once_at: string | null; report_days: number; recipients: string[]; next_run_at: string; last_sent_at: string | null; last_error: string | null }
type Delivery = { id: string; schedule_id: string; status: 'sent' | 'failed'; sent_at: string | null; error_message: string | null; created_at: string }

const weekdays = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const initial = { name: 'Reporte ejecutivo', frequency: 'weekly' as Frequency, scheduled_time: '08:00', weekday: '1', monthday: '1', once_at: '', report_days: '7', recipients: '' }

function frequencyLabel(value: Frequency) {
  return value === 'daily' ? 'Diario' : value === 'weekly' ? 'Semanal' : value === 'monthly' ? 'Mensual' : 'Fecha específica'
}

function date(value: string | null) {
  return value ? new Date(value).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}

function reportPeriodDescription(value: string) {
  const days = Number(value)
  if (!Number.isFinite(days) || days < 1) return 'Define cuántos días de información incluirá cada envío.'
  if (days === 1) return 'Incluye únicamente la información de hoy.'
  return `Incluye los últimos ${days} días, contando hoy.`
}

export function ReportScheduleManager() {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [form, setForm] = useState(initial)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sendingId, setSendingId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/reports/schedules', { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'No se pudo cargar la programación.')
      setSchedules(payload.schedules ?? [])
      setDeliveries(payload.deliveries ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar la programación.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const response = await fetch('/api/reports/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          weekday: form.frequency === 'weekly' ? Number(form.weekday) : null,
          monthday: form.frequency === 'monthly' ? Number(form.monthday) : null,
          recipients: form.recipients.split(/[,;\n]/),
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'No se pudo guardar la programación.')
      setForm(initial)
      toast.success('Programación guardada.')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la programación.')
    } finally {
      setSaving(false)
    }
  }

  const update = async (schedule: Schedule, enabled: boolean) => {
    try {
      const response = await fetch(`/api/reports/schedules/${schedule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'No se pudo actualizar.')
      toast.success(enabled ? 'Envío reactivado.' : 'Envío pausado.')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar.')
    }
  }

  const remove = async (schedule: Schedule) => {
    if (!window.confirm(`¿Eliminar la programación “${schedule.name}”? No se enviarán más reportes.`)) return
    try {
      const response = await fetch(`/api/reports/schedules/${schedule.id}`, { method: 'DELETE' })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error ?? 'No se pudo eliminar.')
      }
      toast.success('Programación eliminada.')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo eliminar.')
    }
  }

  const sendNow = async (schedule: Schedule) => {
    setSendingId(schedule.id)
    try {
      const response = await fetch(`/api/reports/schedules/${schedule.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send_now' }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'No se pudo iniciar el envío.')
      if (payload.failed) throw new Error(payload.error ?? 'El envío falló; revisa Últimas entregas para ver el motivo.')
      if (!payload.sent) throw new Error('El worker no encontró el reporte para enviar. Intenta actualizar la página.')
      toast.success('Reporte enviado. La entrega quedó registrada abajo.')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo enviar el reporte.')
      await load()
    } finally {
      setSendingId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CalendarClock className="size-5 text-primary" /> Envío programado</CardTitle>
        <CardDescription>Envía el reporte ejecutivo con adjuntos CSV y Excel. La hora se interpreta en Ciudad de México.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={create} className="grid gap-3 rounded-lg border border-border p-4 md:grid-cols-2">
          <Input aria-label="Nombre" placeholder="Nombre del reporte" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <Select value={form.frequency} onValueChange={(frequency) => setForm({ ...form, frequency: (frequency ?? 'weekly') as Frequency })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Diario</SelectItem>
              <SelectItem value="weekly">Semanal</SelectItem>
              <SelectItem value="monthly">Mensual</SelectItem>
              <SelectItem value="once">Fecha específica</SelectItem>
            </SelectContent>
          </Select>
          <div className="md:col-span-2">
            <Input aria-label="Correos destinatarios" placeholder="directivo@empresa.com, operaciones@empresa.com" value={form.recipients} onChange={(event) => setForm({ ...form, recipients: event.target.value })} />
            <p className="mt-1 text-xs text-muted-foreground">Hasta 10 destinatarios, separados por coma. El correo se envía mediante el proveedor configurado por NexoOmni.</p>
          </div>
          {form.frequency === 'once' ? (
            <Input aria-label="Fecha de envío" type="datetime-local" value={form.once_at} onChange={(event) => setForm({ ...form, once_at: event.target.value })} />
          ) : (
            <>
              <Input aria-label="Hora de envío" type="time" value={form.scheduled_time} onChange={(event) => setForm({ ...form, scheduled_time: event.target.value })} />
              {form.frequency === 'weekly' ? (
                <Select value={form.weekday} onValueChange={(weekday) => setForm({ ...form, weekday: weekday ?? '1' })}>
                  <SelectTrigger><span>{weekdays[Number(form.weekday)] ?? 'Día de la semana'}</span></SelectTrigger>
                  <SelectContent>{weekdays.map((day, value) => <SelectItem key={day} value={String(value)}>{day}</SelectItem>)}</SelectContent>
                </Select>
              ) : form.frequency === 'monthly' ? (
                <Input aria-label="Día del mes" type="number" min="1" max="31" value={form.monthday} onChange={(event) => setForm({ ...form, monthday: event.target.value })} />
              ) : <div className="hidden md:block" />}
            </>
          )}
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground" htmlFor="report-days">Periodo incluido en cada reporte</label>
            <Input id="report-days" aria-label="Periodo incluido en cada reporte" type="number" min="1" max="365" value={form.report_days} onChange={(event) => setForm({ ...form, report_days: event.target.value })} />
            <p className="text-xs text-muted-foreground">{reportPeriodDescription(form.report_days)}</p>
          </div>
          <Button className="self-start md:mt-6" type="submit" disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : <Send />} Programar envío</Button>
        </form>

        {loading ? <div className="flex justify-center py-4"><Loader2 className="animate-spin text-muted-foreground" /></div> : (
          <div className="space-y-2">
            {schedules.length === 0 ? <p className="text-sm text-muted-foreground">Aún no hay envíos programados.</p> : schedules.map((schedule) => (
              <div key={schedule.id} className="flex flex-col gap-3 rounded-lg border border-border p-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-medium text-foreground">{schedule.name}</p>
                  <p className="text-xs text-muted-foreground">{frequencyLabel(schedule.frequency)} · {schedule.report_days} días incluidos · Próximo: {schedule.enabled ? date(schedule.next_run_at) : 'Pausado'}</p>
                  <p className="text-xs text-muted-foreground">{schedule.recipients.join(', ')}</p>
                  {schedule.last_error ? <p className="mt-1 text-xs text-destructive">Último intento: {schedule.last_error}</p> : null}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={sendingId === schedule.id} onClick={() => void sendNow(schedule)}>{sendingId === schedule.id ? <Loader2 className="animate-spin" /> : <Send />} Enviar ahora</Button>
                  <Button size="sm" variant="outline" onClick={() => void update(schedule, !schedule.enabled)}>{schedule.enabled ? <CirclePause /> : <CirclePlay />}{schedule.enabled ? 'Pausar' : 'Reactivar'}</Button>
                  <Button size="sm" variant="outline" onClick={() => void remove(schedule)}><Trash2 />Eliminar</Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-border pt-4">
          <p className="text-sm font-medium text-foreground">Últimas entregas</p>
          {deliveries.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">Todavía no hay entregas registradas.</p> : (
            <div className="mt-2 space-y-1">{deliveries.slice(0, 5).map((delivery) => (
              <p key={delivery.id} className={delivery.status === 'sent' ? 'text-xs text-emerald-500' : 'text-xs text-destructive'}>
                {delivery.status === 'sent' ? 'Enviado' : 'Falló'} · {date(delivery.sent_at ?? delivery.created_at)}{delivery.error_message ? ` · ${delivery.error_message}` : ''}
              </p>
            ))}</div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
