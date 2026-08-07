'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, PhoneCall, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useTelephony } from './telephony-provider'

type Task = { id: string; conversation_id: string; due_at: string; conversation?: { contact?: { name?: string; phone?: string } | null } | null }

export function CallFollowUpQueue() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const telephony = useTelephony()
  const load = useCallback(async () => { try { const response = await fetch('/api/telephony/follow-up-tasks', { cache: 'no-store' }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setTasks(data.tasks ?? []) } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudieron cargar las llamadas pendientes.') } finally { setLoading(false) } }, [])
  useEffect(() => { void load() }, [load])
  const finish = async (id: string, status: 'completed' | 'cancelled') => { const response = await fetch('/api/telephony/follow-up-tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) }); if (!response.ok) { toast.error('No se pudo actualizar la tarea.'); return } setTasks((items) => items.filter((task) => task.id !== id)) }
  return <div className="space-y-3">{loading ? <p className="text-sm text-muted-foreground">Cargando tareas…</p> : tasks.length ? tasks.map((task) => { const contact = task.conversation?.contact; const label = contact?.name || contact?.phone || 'Contacto'; return <div key={task.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3"><div className="min-w-35 flex-1"><p className="text-sm font-medium">{label}</p><p className="text-xs text-muted-foreground">Pendiente desde {new Date(task.due_at).toLocaleString()}</p></div><Link className="text-xs text-primary hover:underline" href={`/inbox?c=${task.conversation_id}`}>Abrir chat</Link><Button size="sm" variant="outline" disabled={!contact?.phone || !telephony.connected} onClick={() => void telephony.call(contact!.phone!)}><PhoneCall className="size-3.5" />Llamar</Button><Button size="icon" variant="ghost" title="Completar" onClick={() => void finish(task.id, 'completed')}><Check className="size-4 text-emerald-500" /></Button><Button size="icon" variant="ghost" title="Descartar" onClick={() => void finish(task.id, 'cancelled')}><X className="size-4 text-muted-foreground" /></Button></div> }) : <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No tienes llamadas pendientes.</p>}<Button size="sm" variant="ghost" onClick={() => { setLoading(true); void load() }}><RefreshCw className="size-3.5" />Actualizar</Button></div>
}
