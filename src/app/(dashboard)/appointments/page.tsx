'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import { CalendarDays, CheckCircle2, CircleX, ClipboardCheck, Link2, Loader2, Pencil, Plus, RefreshCw, UserRoundX, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { toast } from 'sonner'

type Appointment = {
  id: string; contact_id: string | null; assigned_agent_id: string | null; title: string
  starts_at: string; ends_at: string; status: string; notes: string | null
  google_sync_status: 'not_connected' | 'pending' | 'synced' | 'failed'; google_sync_error: string | null
  contact: { name: string | null; phone: string | null } | null; agent: { full_name: string | null } | null
}
type ContactOption = { id: string; name: string | null; phone: string | null }
type MemberOption = { user_id: string; full_name: string; is_active: boolean }
const STATUS: Record<string, string> = { scheduled: 'Programada', confirmed: 'Confirmada', completed: 'Completada', cancelled: 'Cancelada', no_show: 'No asistió' }
const DURATIONS = [15, 30, 45, 60]

function localDateTime(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000
  return new Date(value.getTime() - offset).toISOString().slice(0, 16)
}

function appointmentTime(value: string) {
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export default function AppointmentsPage() {
  const { accountId, user } = useAuth()
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [duration, setDuration] = useState(30)
  const [contactId, setContactId] = useState('')
  const [assignedAgentId, setAssignedAgentId] = useState('')
  const [notes, setNotes] = useState('')
  const [contacts, setContacts] = useState<ContactOption[]>([])
  const [members, setMembers] = useState<MemberOption[]>([])
  const [googleConnectionCount, setGoogleConnectionCount] = useState(0)
  const [googleAssigneeId, setGoogleAssigneeId] = useState('')
  const [googleAvailable, setGoogleAvailable] = useState(false)
  const [connectingGoogle, setConnectingGoogle] = useState(false)
  const [syncingId, setSyncingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null)
    try {
      const response = await fetch('/api/appointments', { cache: 'no-store' })
      if (response.status === 403) { setEnabled(false); return }
      const payload = await response.json().catch(() => null) as { appointments?: Appointment[]; error?: string } | null
      if (!response.ok) throw new Error(payload?.error || 'No se pudieron cargar las citas.')
      setEnabled(true); setAppointments(payload?.appointments ?? [])
    } catch (error) { setLoadError(error instanceof Error ? error.message : 'No se pudieron cargar las citas.') }
    finally { setLoading(false) }
  }, [])

  const loadGoogleConnection = useCallback(async () => {
    try {
      const response = await fetch('/api/appointments/google', { cache: 'no-store' })
      const payload = response.ok ? await response.json() as { configured?: boolean; connections?: unknown[] } : null
      setGoogleAvailable(payload?.configured === true); setGoogleConnectionCount(payload?.connections?.length ?? 0)
    } catch { setGoogleAvailable(false); setGoogleConnectionCount(0) }
  }, [])

  useEffect(() => { void load(); void loadGoogleConnection() }, [load, loadGoogleConnection])

  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    const supabase = createClient()
    void Promise.all([
      supabase.from('contacts').select('id, name, phone').eq('account_id', accountId).order('name').limit(100),
      fetch('/api/account/members', { cache: 'no-store' }).then(async (response) => response.ok ? response.json() as Promise<{ members?: MemberOption[] }> : null),
    ]).then(([contactResult, memberPayload]) => {
      if (cancelled) return
      setContacts((contactResult.data ?? []) as ContactOption[])
      setMembers((memberPayload?.members ?? []).filter((member) => member.is_active))
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [accountId])

  function resetForm() {
    setEditingId(null); setTitle(''); setStartsAt(''); setEndsAt(''); setDuration(30)
    setContactId(''); setAssignedAgentId(''); setNotes(''); setShowForm(false)
  }

  function startNew() { resetForm(); setShowForm(true) }

  function editAppointment(appointment: Appointment) {
    const starts = new Date(appointment.starts_at); const ends = new Date(appointment.ends_at)
    setEditingId(appointment.id); setTitle(appointment.title); setStartsAt(localDateTime(starts)); setEndsAt(localDateTime(ends))
    setDuration(Math.max(1, Math.round((ends.getTime() - starts.getTime()) / 60_000)))
    setContactId(appointment.contact_id ?? ''); setAssignedAgentId(appointment.assigned_agent_id ?? ''); setNotes(appointment.notes ?? '')
    setShowForm(true)
    window.setTimeout(() => document.getElementById('appointment-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  function updateStart(value: string) {
    setStartsAt(value)
    const start = new Date(value)
    if (!Number.isNaN(start.getTime())) setEndsAt(localDateTime(new Date(start.getTime() + duration * 60_000)))
  }

  function updateDuration(value: number) {
    setDuration(value)
    const start = new Date(startsAt)
    if (!Number.isNaN(start.getTime())) setEndsAt(localDateTime(new Date(start.getTime() + value * 60_000)))
  }

  async function saveAppointment(event: FormEvent) {
    event.preventDefault()
    if (!startsAt || !endsAt) return toast.error('Indica fecha y hora de inicio y término.')
    setSaving(true)
    try {
      const body = { ...(editingId ? { id: editingId } : {}), title, starts_at: new Date(startsAt).toISOString(), ends_at: new Date(endsAt).toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, contact_id: contactId || null, assigned_agent_id: assignedAgentId || user?.id || null, notes }
      const response = await fetch('/api/appointments', { method: editingId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const payload = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || 'No se pudo guardar la cita.')
      toast.success(editingId ? 'Cita actualizada y sincronizada con Google Calendar.' : 'Cita creada.')
      resetForm(); await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo guardar la cita.') }
    finally { setSaving(false) }
  }

  async function updateStatus(id: string, status: string) {
    const response = await fetch('/api/appointments', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) })
    if (!response.ok) { toast.error('No se pudo actualizar el estado.'); return }
    await load()
  }

  async function retryGoogleSync(id: string) {
    setSyncingId(id)
    try {
      const response = await fetch(`/api/appointments/${id}/google-sync`, { method: 'POST' })
      if (!response.ok) toast.error('No se pudo sincronizar con Google Calendar.')
      await load()
    } finally { setSyncingId(null) }
  }

  async function connectGoogle() {
    setConnectingGoogle(true)
    try {
      const response = await fetch('/api/appointments/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assigned_agent_id: googleAssigneeId || null }) })
      const payload = await response.json().catch(() => null) as { authorize_url?: string; error?: string } | null
      if (!response.ok || !payload?.authorize_url) throw new Error(payload?.error || 'No se pudo iniciar la conexión con Google.')
      window.location.assign(payload.authorize_url)
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo conectar Google Calendar.') }
    finally { setConnectingGoogle(false) }
  }

  if (loading) return <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
  if (enabled === false) return <div className="mx-auto max-w-xl py-16 text-center"><CalendarDays className="mx-auto size-8 text-muted-foreground" /><h1 className="mt-3 text-lg font-semibold">Agenda deshabilitada</h1><p className="mt-1 text-sm text-muted-foreground">Un administrador puede habilitar Agenda de citas desde Configuración → Objetivo operativo.</p></div>

  return <div className="mx-auto max-w-5xl space-y-6 p-5 sm:p-7">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="flex items-center gap-2 text-2xl font-bold"><CalendarDays className="size-6 text-primary" />Agenda de citas</h1><p className="mt-1 text-sm text-muted-foreground">Crea, reagenda y conserva el historial de las citas del equipo.</p>{googleAvailable ? <p className={googleConnectionCount ? 'mt-1 text-xs text-emerald-600' : 'mt-1 text-xs text-amber-600'}>{googleConnectionCount ? `${googleConnectionCount} calendario(s) Google conectado(s).` : 'Aún no hay un calendario Google conectado.'}</p> : null}</div>
      <div className="flex flex-wrap gap-2">{googleAvailable ? <><select value={googleAssigneeId} onChange={(event) => setGoogleAssigneeId(event.target.value)} className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm"><option value="">Calendario general</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name || 'Responsable sin nombre'}</option>)}</select><Button variant="outline" onClick={() => void connectGoogle()} disabled={connectingGoogle}>{connectingGoogle ? <Loader2 className="animate-spin" /> : <Link2 />}{googleConnectionCount ? 'Reconectar Google' : 'Conectar Google Calendar'}</Button></> : null}<Button onClick={startNew}><Plus />Nueva cita</Button></div>
    </div>

    {showForm ? <Card id="appointment-form"><CardHeader><CardTitle>{editingId ? 'Editar / reagendar cita' : 'Nueva cita'}</CardTitle><CardDescription>{editingId ? 'Al guardar se actualiza esta misma cita y su evento existente en Google Calendar.' : 'La cita se sincroniza con el calendario del responsable conectado.'}</CardDescription></CardHeader><CardContent><form className="grid gap-3 sm:grid-cols-2" onSubmit={saveAppointment}><Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Motivo de la cita" required /><select value={contactId} onChange={(event) => setContactId(event.target.value)} className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm"><option value="">Sin contacto asociado</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name || contact.phone || 'Contacto sin nombre'}</option>)}</select><select value={assignedAgentId} onChange={(event) => setAssignedAgentId(event.target.value)} className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm"><option value="">Responsable: yo</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name || 'Miembro sin nombre'}</option>)}</select><Input type="datetime-local" value={startsAt} onChange={(event) => updateStart(event.target.value)} required /><div className="flex flex-wrap gap-1 sm:col-span-2">{DURATIONS.map((value) => <Button key={value} type="button" variant={duration === value ? 'default' : 'outline'} size="sm" onClick={() => updateDuration(value)}>{value} min</Button>)}</div><Input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required /><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notas internas" rows={3} className="resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm" /><div className="flex gap-2 sm:col-span-2"><Button type="submit" disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : null}{editingId ? 'Guardar y reagendar' : 'Crear cita'}</Button><Button type="button" variant="outline" onClick={resetForm}><X />Cancelar</Button></div></form></CardContent></Card> : null}

    {loadError ? <Card><CardContent className="pt-6 text-sm text-destructive">No se pudieron cargar las citas: {loadError}</CardContent></Card> : <div className="space-y-3">{appointments.length === 0 ? <Card><CardContent className="pt-6 text-sm text-muted-foreground">No hay citas en los próximos 30 días.</CardContent></Card> : appointments.map((appointment) => <Card key={appointment.id}><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-base">{appointment.title}</CardTitle><CardDescription>{appointment.contact?.name || 'Sin contacto'}{appointment.agent?.full_name ? ` · ${appointment.agent.full_name}` : ''}</CardDescription></div><span className="text-xs text-muted-foreground">{STATUS[appointment.status] || appointment.status}</span></div></CardHeader><CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground"><div><span>{appointmentTime(appointment.starts_at)}</span>{appointment.notes ? <p className="mt-1 text-xs">{appointment.notes}</p> : null}<p className={appointment.google_sync_status === 'failed' ? 'mt-1 text-xs text-destructive' : 'mt-1 text-xs text-muted-foreground'}>{appointment.google_sync_status === 'synced' ? 'Google Calendar sincronizado' : appointment.google_sync_status === 'pending' ? 'Google Calendar pendiente' : appointment.google_sync_status === 'failed' ? `Google Calendar: ${appointment.google_sync_error || 'Falló la sincronización.'}` : 'Sin calendario Google conectado para este responsable'}</p></div><div className="flex flex-wrap gap-2">{appointment.google_sync_status !== 'synced' ? <Button variant="outline" size="sm" onClick={() => void retryGoogleSync(appointment.id)} disabled={syncingId === appointment.id}>{syncingId === appointment.id ? <Loader2 className="animate-spin" /> : <RefreshCw />}Reintentar Google</Button> : null}{['scheduled', 'confirmed'].includes(appointment.status) ? <><Button variant="outline" size="sm" onClick={() => editAppointment(appointment)}><Pencil />Editar / reagendar</Button>{appointment.status === 'scheduled' ? <Button variant="outline" size="sm" onClick={() => void updateStatus(appointment.id, 'confirmed')}><CheckCircle2 />Confirmar</Button> : null}<Button variant="outline" size="sm" onClick={() => void updateStatus(appointment.id, 'completed')}><ClipboardCheck />Completar</Button><Button variant="outline" size="sm" onClick={() => void updateStatus(appointment.id, 'no_show')}><UserRoundX />No asistió</Button><Button variant="outline" size="sm" className="text-destructive" onClick={() => void updateStatus(appointment.id, 'cancelled')}><CircleX />Cancelar</Button></> : null}</div></CardContent>{appointment.status === 'completed' ? <p className="px-6 pb-5 text-xs text-muted-foreground">Cita realizada: se conserva como historial y no se elimina del calendario.</p> : null}</Card>)}</div>}
  </div>
}
