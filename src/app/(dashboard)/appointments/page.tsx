'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import { CalendarDays, CheckCircle2, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type Appointment = { id: string; title: string; starts_at: string; ends_at: string; status: string; notes: string | null; contact: { name: string | null; phone: string | null } | null; agent: { full_name: string | null } | null }
const STATUS: Record<string, string> = { scheduled: 'Programada', confirmed: 'Confirmada', completed: 'Completada', cancelled: 'Cancelada', no_show: 'No asistió' }

export default function AppointmentsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/appointments', { cache: 'no-store' })
      if (response.status === 403) { setEnabled(false); return }
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error)
      setEnabled(true); setAppointments(payload.appointments ?? [])
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function create(event: FormEvent) {
    event.preventDefault()
    const response = await fetch('/api/appointments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, starts_at: new Date(startsAt).toISOString(), ends_at: new Date(endsAt).toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) })
    if (!response.ok) return
    setTitle(''); setStartsAt(''); setEndsAt(''); setCreating(false); await load()
  }
  async function confirm(id: string) { await fetch('/api/appointments', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status: 'confirmed' }) }); await load() }

  if (loading) return <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
  if (enabled === false) return <div className="mx-auto max-w-xl py-16 text-center"><CalendarDays className="mx-auto size-8 text-muted-foreground" /><h1 className="mt-3 text-lg font-semibold">Agenda deshabilitada</h1><p className="mt-1 text-sm text-muted-foreground">Un administrador puede habilitar Agenda de citas desde Configuración → Objetivo operativo.</p></div>
  return <div className="mx-auto max-w-5xl space-y-6 p-5 sm:p-7"><div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="flex items-center gap-2 text-2xl font-bold"><CalendarDays className="size-6 text-primary" />Agenda de citas</h1><p className="mt-1 text-sm text-muted-foreground">Agenda interna de NexoOmni. La sincronización de calendarios se conectará sobre estas citas.</p></div><Button onClick={() => setCreating((value) => !value)}><Plus />Nueva cita</Button></div>
    {creating ? <Card><CardContent className="pt-6"><form className="grid gap-3 sm:grid-cols-3" onSubmit={create}><Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Motivo de la cita" required /><Input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required /><Input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required /><Button type="submit" className="sm:col-span-3">Crear cita</Button></form></CardContent></Card> : null}
    <div className="space-y-3">{appointments.length === 0 ? <Card><CardContent className="pt-6 text-sm text-muted-foreground">No hay citas en los próximos 30 días.</CardContent></Card> : appointments.map((appointment) => <Card key={appointment.id}><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-base">{appointment.title}</CardTitle><CardDescription>{appointment.contact?.name || 'Sin contacto'}{appointment.agent?.full_name ? ` · ${appointment.agent.full_name}` : ''}</CardDescription></div><span className="text-xs text-muted-foreground">{STATUS[appointment.status]}</span></div></CardHeader><CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground"><span>{new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(appointment.starts_at))}</span>{appointment.status === 'scheduled' ? <Button variant="outline" size="sm" onClick={() => void confirm(appointment.id)}><CheckCircle2 />Confirmar</Button> : null}</CardContent></Card>)}</div></div>
}