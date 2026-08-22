'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import { CalendarDays, CheckCircle2, CircleX, ClipboardCheck, Link2, Loader2, Plus, UserRoundX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'

type Appointment = { id: string; title: string; starts_at: string; ends_at: string; status: string; notes: string | null; contact: { name: string | null; phone: string | null } | null; agent: { full_name: string | null } | null }
type ContactOption = { id: string; name: string | null; phone: string | null }
type MemberOption = { user_id: string; full_name: string; is_active: boolean }
const STATUS: Record<string, string> = { scheduled: 'Programada', confirmed: 'Confirmada', completed: 'Completada', cancelled: 'Cancelada', no_show: 'No asistió' }
const DURATIONS = [15, 30, 45, 60]

export default function AppointmentsPage() {
  const { accountId } = useAuth()
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [duration, setDuration] = useState(30)
  const [contactId, setContactId] = useState('')
  const [assignedAgentId, setAssignedAgentId] = useState('')
  const [notes, setNotes] = useState('')
  const [contacts, setContacts] = useState<ContactOption[]>([])
  const [members, setMembers] = useState<MemberOption[]>([])
  const [googleConnected, setGoogleConnected] = useState(false)
  const [googleAvailable, setGoogleAvailable] = useState(false)
  const [connectingGoogle, setConnectingGoogle] = useState(false)

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

  useEffect(() => {
    void fetch('/api/appointments/google', { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() as Promise<{ configured?: boolean; connection?: unknown }> : null)
      .then((payload) => { setGoogleAvailable(payload?.configured === true); setGoogleConnected(Boolean(payload?.connection)); })
      .catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!accountId) return () => { cancelled = true }
    const supabase = createClient()
    void Promise.all([
      supabase.from('contacts').select('id, name, phone').eq('account_id', accountId).order('name').limit(100),
      fetch('/api/account/members', { cache: 'no-store' }).then(async (response) => response.ok ? response.json() as Promise<{ members?: MemberOption[] }> : null),
    ]).then(([contactResult, memberPayload]) => {
      if (cancelled) return
      setContacts((contactResult.data ?? []) as ContactOption[])
      setMembers((memberPayload?.members ?? []).filter((member) => member.is_active))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [accountId])

  function updateStart(value: string) {
    setStartsAt(value)
    const start = new Date(value)
    if (!Number.isNaN(start.getTime())) setEndsAt(new Date(start.getTime() + duration * 60_000).toISOString().slice(0, 16))
  }

  function updateDuration(value: number) {
    setDuration(value)
    if (startsAt) {
      const start = new Date(startsAt)
      if (!Number.isNaN(start.getTime())) setEndsAt(new Date(start.getTime() + value * 60_000).toISOString().slice(0, 16))
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault()
    const response = await fetch('/api/appointments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, starts_at: new Date(startsAt).toISOString(), ends_at: new Date(endsAt).toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, contact_id: contactId || null, assigned_agent_id: assignedAgentId || undefined, notes }) })
    if (!response.ok) return
    setTitle(''); setStartsAt(''); setEndsAt(''); setContactId(''); setAssignedAgentId(''); setNotes(''); setCreating(false); await load()
  }
  async function updateStatus(id: string, status: string) { await fetch('/api/appointments', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) }); await load() }
  async function connectGoogle() {
    setConnectingGoogle(true)
    try {
      const response = await fetch('/api/appointments/google', { method: 'POST' })
      const payload = await response.json().catch(() => null) as { authorize_url?: string } | null
      if (response.ok && payload?.authorize_url) window.location.assign(payload.authorize_url)
    } finally { setConnectingGoogle(false) }
  }

  if (loading) return <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
  if (enabled === false) return <div className="mx-auto max-w-xl py-16 text-center"><CalendarDays className="mx-auto size-8 text-muted-foreground" /><h1 className="mt-3 text-lg font-semibold">Agenda deshabilitada</h1><p className="mt-1 text-sm text-muted-foreground">Un administrador puede habilitar Agenda de citas desde Configuración → Objetivo operativo.</p></div>
  return <div className="mx-auto max-w-5xl space-y-6 p-5 sm:p-7"><div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="flex items-center gap-2 text-2xl font-bold"><CalendarDays className="size-6 text-primary" />Agenda de citas</h1><p className="mt-1 text-sm text-muted-foreground">NexoOmni conserva las citas y las refleja en el calendario conectado.</p></div><div className="flex gap-2">{googleAvailable ? <Button variant="outline" onClick={() => void connectGoogle()} disabled={connectingGoogle || googleConnected}>{connectingGoogle ? <Loader2 className="animate-spin" /> : <Link2 />}{googleConnected ? 'Google Calendar conectado' : 'Conectar Google Calendar'}</Button> : null}<Button onClick={() => setCreating((value) => !value)}><Plus />Nueva cita</Button></div></div>
    {creating ? <Card><CardContent className="pt-6"><form className="grid gap-3 sm:grid-cols-2" onSubmit={create}><Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Motivo de la cita" required /><select value={contactId} onChange={(event) => setContactId(event.target.value)} className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"><option value="">Sin contacto asociado</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name || contact.phone || 'Contacto sin nombre'}</option>)}</select><select value={assignedAgentId} onChange={(event) => setAssignedAgentId(event.target.value)} className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"><option value="">Responsable: yo</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name || 'Miembro sin nombre'}</option>)}</select><Input type="datetime-local" value={startsAt} onChange={(event) => updateStart(event.target.value)} required /><div className="flex flex-wrap gap-1 sm:col-span-2">{DURATIONS.map((value) => <Button key={value} type="button" variant={duration === value ? 'default' : 'outline'} size="sm" onClick={() => updateDuration(value)}>{value} min</Button>)}</div><Input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required /><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notas internas" rows={2} className="resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm" /><Button type="submit" className="sm:col-span-2">Crear cita</Button></form></CardContent></Card> : null}
    <div className="space-y-3">{appointments.length === 0 ? <Card><CardContent className="pt-6 text-sm text-muted-foreground">No hay citas en los próximos 30 días.</CardContent></Card> : appointments.map((appointment) => <Card key={appointment.id}><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-base">{appointment.title}</CardTitle><CardDescription>{appointment.contact?.name || 'Sin contacto'}{appointment.agent?.full_name ? ` · ${appointment.agent.full_name}` : ''}</CardDescription></div><span className="text-xs text-muted-foreground">{STATUS[appointment.status]}</span></div></CardHeader><CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground"><div><span>{new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(appointment.starts_at))}</span>{appointment.notes ? <p className="mt-1 text-xs">{appointment.notes}</p> : null}</div>{['scheduled', 'confirmed'].includes(appointment.status) ? <div className="flex flex-wrap gap-2">{appointment.status === 'scheduled' ? <Button variant="outline" size="sm" onClick={() => void updateStatus(appointment.id, 'confirmed')}><CheckCircle2 />Confirmar</Button> : null}<Button variant="outline" size="sm" onClick={() => void updateStatus(appointment.id, 'completed')}><ClipboardCheck />Completar</Button><Button variant="outline" size="sm" onClick={() => void updateStatus(appointment.id, 'no_show')}><UserRoundX />No asistió</Button><Button variant="outline" size="sm" className="text-destructive" onClick={() => void updateStatus(appointment.id, 'cancelled')}><CircleX />Cancelar</Button></div> : null}</CardContent></Card>)}</div></div>
}