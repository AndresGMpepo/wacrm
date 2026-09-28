'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Calendar, Check, Plus, PhoneCall, RefreshCw, ShieldAlert, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { createClient } from '@/lib/supabase/client'
import { useTelephony } from '@/components/telephony/telephony-provider'

type Analysis = { sentiment?: string | null; sentiment_score?: number | null; qa_score?: number | null; next_best_action?: string | null }
type CallTask = { id: string; conversation_id: string; due_at: string; conversation?: { contact?: { name?: string; phone?: string } | null } | null; latest_analysis?: Analysis | null }
type Commitment = { id: string; contact_id: string; contact_name: string; description: string; owner: 'agent' | 'customer'; due_date: string | null }
type Task = { id: string; contact_id: string; contact_name: string; description: string; owner: 'agent' | 'customer'; due_date: string | null; due_at: string | null }
type HighRiskContact = { contact_id: string; contact_name: string; opportunity_score: number | null; next_best_action: string | null; updated_at: string }
type StaleProspect = { contact_id: string; contact_name: string; current_stage: string | null; updated_at: string }
type ContactOption = { id: string; name: string | null; phone: string | null }

/** One unified shape so a call no-reply task and a Nexo Memory signal
 *  (overdue commitment, upcoming task, high-risk contact, stale prospect)
 *  render as the same kind of row instead of several visually redundant
 *  lists. */
type FollowUpItem = {
  key: string
  since: string
  contactName: string
  contactPhone: string | null
  detail: string
  meta: string | null
  metaClass: string
  conversationId: string | null
  commitment: { id: string; contactId: string } | null
}

const sentimentLabel: Record<string, string> = { positive: 'Positivo', neutral: 'Neutral', negative: 'Negativo', mixed: 'Mixto' }
const sentimentClass: Record<string, string> = { positive: 'text-emerald-500', neutral: 'text-sky-500', negative: 'text-red-500', mixed: 'text-amber-500' }

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

/** Friendly "en 45 min" / "Mañana 09:00" / plain-date countdown for a task. */
function formatDueLabel(dueAt: string | null, dueDate: string | null) {
  if (dueAt) {
    const date = new Date(dueAt)
    const now = new Date()
    const diffMin = Math.round((date.getTime() - now.getTime()) / 60_000)
    const time = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit' }).format(date)
    if (diffMin <= 0) return `Venciendo · ${time}`
    if (diffMin < 60) return `En ${diffMin} min`
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    if (date.toDateString() === now.toDateString()) return `Hoy ${time}`
    if (date.toDateString() === tomorrow.toDateString()) return `Mañana ${time}`
    return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
  }
  if (dueDate) return `Para el ${new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date(`${dueDate}T00:00:00`))}`
  return 'Sin fecha'
}

/** Tomorrow at 09:00, as `{date, time}` for the "Nueva tarea" form defaults. */
function defaultTaskWhen() {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return { date: tomorrow.toISOString().slice(0, 10), time: '09:00' }
}

export function NexoFollowUpsQueue() {
  const [items, setItems] = useState<FollowUpItem[]>([])
  const [loading, setLoading] = useState(true)
  const telephony = useTelephony()

  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [contactQuery, setContactQuery] = useState('')
  const [contactResults, setContactResults] = useState<ContactOption[]>([])
  const [selectedContact, setSelectedContact] = useState<ContactOption | null>(null)
  const [taskDescription, setTaskDescription] = useState('')
  const [taskDate, setTaskDate] = useState('')
  const [taskTime, setTaskTime] = useState('09:00')
  const [savingTask, setSavingTask] = useState(false)

  const load = useCallback(async () => {
    try {
      const [callTasksResponse, memoryResponse] = await Promise.all([
        fetch('/api/telephony/follow-up-tasks', { cache: 'no-store' }),
        fetch('/api/contacts/memory/follow-ups', { cache: 'no-store' }),
      ])
      const callTasksData = callTasksResponse.ok ? await callTasksResponse.json() : null
      const memoryData = memoryResponse.ok ? await memoryResponse.json() : null
      if (!callTasksResponse.ok && !memoryResponse.ok) throw new Error('No se pudieron cargar los seguimientos.')

      const callItems: FollowUpItem[] = ((callTasksData?.tasks ?? []) as CallTask[]).map((task) => {
        const analysis = task.latest_analysis
        const sentiment = analysis?.sentiment ?? ''
        return {
          key: `call-${task.id}`,
          since: task.due_at,
          contactName: task.conversation?.contact?.name || task.conversation?.contact?.phone || 'Contacto',
          contactPhone: task.conversation?.contact?.phone ?? null,
          detail: analysis?.next_best_action || 'Sin análisis previo: atiende el seguimiento desde el historial del chat.',
          meta: analysis ? `${sentimentLabel[sentiment] ?? 'Sin sentimiento'}${analysis.sentiment_score != null ? ` · ${analysis.sentiment_score}/100` : ''}${analysis.qa_score != null ? ` · QA ${analysis.qa_score}/100` : ''}` : null,
          metaClass: sentimentClass[sentiment] ?? 'text-muted-foreground',
          conversationId: task.conversation_id,
          commitment: null,
        }
      })
      const commitmentItems: FollowUpItem[] = ((memoryData?.overdue_commitments ?? []) as Commitment[]).map((item) => ({
        key: `commitment-${item.id}`,
        since: item.due_date ?? new Date(0).toISOString(),
        contactName: item.contact_name,
        contactPhone: null,
        detail: `${item.description}${item.owner === 'customer' ? ' (cliente)' : ''}`,
        meta: 'Compromiso vencido (Nexo Memory)',
        metaClass: 'text-amber-500',
        conversationId: null,
        commitment: { id: item.id, contactId: item.contact_id },
      }))
      const taskItems: FollowUpItem[] = ((memoryData?.upcoming_tasks ?? []) as Task[]).map((item) => ({
        key: `task-${item.id}`,
        since: item.due_at ?? item.due_date ?? new Date().toISOString(),
        contactName: item.contact_name,
        contactPhone: null,
        detail: `${item.description}${item.owner === 'customer' ? ' (cliente)' : ''}`,
        meta: `Tarea programada · ${formatDueLabel(item.due_at, item.due_date)}`,
        metaClass: 'text-sky-500',
        conversationId: null,
        commitment: { id: item.id, contactId: item.contact_id },
      }))
      const riskItems: FollowUpItem[] = ((memoryData?.high_risk_contacts ?? []) as HighRiskContact[]).map((item) => ({
        key: `risk-${item.contact_id}`,
        since: item.updated_at,
        contactName: item.contact_name,
        contactPhone: null,
        detail: item.next_best_action || 'Revisar la relación con este cliente.',
        meta: `Riesgo alto (Nexo Memory)${item.opportunity_score != null ? ` · Oportunidad ${item.opportunity_score}/100` : ''}`,
        metaClass: 'text-red-500',
        conversationId: null,
        commitment: null,
      }))
      const staleItems: FollowUpItem[] = ((memoryData?.stale_prospects ?? []) as StaleProspect[]).map((item) => ({
        key: `stale-${item.contact_id}`,
        since: item.updated_at,
        contactName: item.contact_name,
        contactPhone: null,
        detail: item.current_stage ? `Etapa: ${item.current_stage}` : 'Sin seguimiento reciente.',
        meta: 'Sin seguimiento en 48h (Nexo Memory)',
        metaClass: 'text-muted-foreground',
        conversationId: null,
        commitment: null,
      }))

      setItems([...callItems, ...taskItems, ...commitmentItems, ...riskItems, ...staleItems].sort((a, b) => a.since.localeCompare(b.since)))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron cargar los seguimientos.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const finishCallTask = async (key: string, status: 'completed' | 'cancelled') => {
    const id = key.replace('call-', '')
    const response = await fetch('/api/telephony/follow-up-tasks', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }),
    })
    if (!response.ok) { toast.error('No se pudo actualizar el seguimiento.'); return }
    setItems((current) => current.filter((item) => item.key !== key))
  }

  const updateCommitment = async (key: string, commitment: { id: string; contactId: string }, status: 'done' | 'cancelled') => {
    const response = await fetch(`/api/contacts/${commitment.contactId}/memory/commitments/${commitment.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    })
    if (!response.ok) { toast.error('No se pudo actualizar la tarea.'); return }
    setItems((current) => current.filter((item) => item.key !== key))
  }

  const searchContacts = async (query: string) => {
    setContactQuery(query)
    setSelectedContact(null)
    const trimmed = query.trim()
    if (trimmed.length < 2) { setContactResults([]); return }
    const supabase = createClient()
    const like = `%${trimmed}%`
    const { data } = await supabase.from('contacts').select('id, name, phone').or(`name.ilike.${like},phone.ilike.${like}`).limit(6)
    setContactResults((data ?? []) as ContactOption[])
  }

  const openNewTask = () => {
    const { date, time } = defaultTaskWhen()
    setTaskDate(date)
    setTaskTime(time)
    setTaskDescription('')
    setContactQuery('')
    setContactResults([])
    setSelectedContact(null)
    setNewTaskOpen(true)
  }

  const createTask = async () => {
    const description = taskDescription.trim()
    const phone = selectedContact ? null : contactQuery.trim()
    if (!description) { toast.error('Escribe una breve descripción de la tarea.'); return }
    if (!selectedContact && !phone) { toast.error('Busca un contacto o indica un número de teléfono.'); return }
    if (!taskDate || !taskTime) { toast.error('Indica la fecha y la hora del recordatorio.'); return }
    setSavingTask(true)
    try {
      const dueAt = new Date(`${taskDate}T${taskTime}`)
      const response = await fetch('/api/contacts/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: selectedContact?.id,
          phone: selectedContact ? undefined : phone,
          description,
          dueAt: dueAt.toISOString(),
        }),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(json?.error || 'No se pudo crear la tarea.')
      toast.success('Tarea de seguimiento creada. Te avisaremos 10 minutos antes.')
      setNewTaskOpen(false)
      void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear la tarea.')
    } finally {
      setSavingTask(false)
    }
  }

  return <div className="space-y-3">
    <div className="flex justify-end">
      <Button size="sm" onClick={openNewTask}><Plus className="size-3.5" />Nueva tarea</Button>
    </div>
    {loading ? <p className="text-sm text-muted-foreground">Cargando seguimientos…</p> : items.length ? items.map((item) => (
      <div key={item.key} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
        <div className="min-w-50 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-medium">{item.meta?.includes('Riesgo alto') ? <ShieldAlert className="size-3.5 text-red-400" /> : null}{item.contactName}</p>
          <p className="text-xs text-muted-foreground">Pendiente desde {formatDate(item.since)}</p>
          {item.meta ? <p className={`mt-1 text-xs ${item.metaClass}`}>{item.meta}</p> : null}
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{item.detail}</p>
        </div>
        {item.conversationId ? <Link className="text-xs text-primary hover:underline" href={`/inbox?c=${item.conversationId}`}>Abrir chat</Link> : <Link className="text-xs text-primary hover:underline" href="/contacts">Ver contacto</Link>}
        {item.conversationId ? <Button size="sm" variant="outline" disabled={!item.contactPhone || !telephony.connected} onClick={() => void telephony.call(item.contactPhone!)}><PhoneCall className="size-3.5" />Llamar</Button> : null}
        {item.commitment ? (
          <>
            <Button size="icon" variant="ghost" title="Marcar hecho" onClick={() => void updateCommitment(item.key, item.commitment!, 'done')}><Check className="size-4 text-emerald-500" /></Button>
            <Button size="icon" variant="ghost" title="Cancelar" onClick={() => void updateCommitment(item.key, item.commitment!, 'cancelled')}><X className="size-4 text-muted-foreground" /></Button>
          </>
        ) : item.conversationId ? (
          <>
            <Button size="icon" variant="ghost" title="Completar" onClick={() => void finishCallTask(item.key, 'completed')}><Check className="size-4 text-emerald-500" /></Button>
            <Button size="icon" variant="ghost" title="Descartar" onClick={() => void finishCallTask(item.key, 'cancelled')}><X className="size-4 text-muted-foreground" /></Button>
          </>
        ) : null}
      </div>
    )) : <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No tienes seguimientos pendientes.</p>}
    <Button size="sm" variant="ghost" onClick={() => { setLoading(true); void load() }}><RefreshCw className="size-3.5" />Actualizar</Button>

    <Dialog open={newTaskOpen} onOpenChange={setNewTaskOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva tarea de seguimiento</DialogTitle>
          <DialogDescription>Te avisaremos 10 minutos antes de la hora que elijas.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="task-contact">Contacto</Label>
            {selectedContact ? (
              <div className="mt-1.5 flex items-center justify-between rounded-md border border-border px-2.5 py-2 text-sm">
                <span>{selectedContact.name || selectedContact.phone || 'Contacto'}{selectedContact.phone ? ` · ${selectedContact.phone}` : ''}</span>
                <Button size="icon-sm" variant="ghost" onClick={() => { setSelectedContact(null); setContactQuery('') }}><X className="size-3.5" /></Button>
              </div>
            ) : (
              <div className="relative mt-1.5">
                <Input id="task-contact" value={contactQuery} onChange={(event) => void searchContacts(event.target.value)} placeholder="Busca por nombre o escribe un teléfono" autoComplete="off" />
                {contactResults.length > 0 ? (
                  <div className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md">
                    {contactResults.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className="flex w-full flex-col items-start px-2.5 py-1.5 text-left text-sm hover:bg-muted"
                        onClick={() => { setSelectedContact(option); setContactResults([]) }}
                      >
                        <span className="font-medium">{option.name || 'Sin nombre'}</span>
                        <span className="text-xs text-muted-foreground">{option.phone}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">Si no encuentras el contacto, escribe el número y se creará uno nuevo.</p>
          </div>
          <div>
            <Label htmlFor="task-description">¿Qué hay que hacer?</Label>
            <Textarea id="task-description" className="mt-1.5" rows={2} value={taskDescription} onChange={(event) => setTaskDescription(event.target.value)} placeholder="Ej. Llamar para dar seguimiento a la cotización" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="task-date">Fecha</Label>
              <Input id="task-date" type="date" className="mt-1.5" value={taskDate} onChange={(event) => setTaskDate(event.target.value)} />
            </div>
            <div>
              <Label htmlFor="task-time">Hora</Label>
              <Input id="task-time" type="time" className="mt-1.5" value={taskTime} onChange={(event) => setTaskTime(event.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setNewTaskOpen(false)}>Cancelar</Button>
          <Button disabled={savingTask} onClick={() => void createTask()}><Calendar className="size-3.5" />{savingTask ? 'Guardando…' : 'Crear tarea'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
}

