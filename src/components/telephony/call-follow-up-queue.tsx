'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, PhoneCall, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useTelephony } from './telephony-provider'

type Analysis = {
  sentiment?: string | null
  sentiment_score?: number | null
  qa_score?: number | null
  next_best_action?: string | null
}
type Task = {
  id: string
  conversation_id: string
  due_at: string
  conversation?: { contact?: { name?: string; phone?: string } | null } | null
  latest_analysis?: Analysis | null
}

const sentimentLabel: Record<string, string> = { positive: 'Positivo', neutral: 'Neutral', negative: 'Negativo', mixed: 'Mixto' }
const sentimentClass: Record<string, string> = { positive: 'text-emerald-500', neutral: 'text-sky-500', negative: 'text-red-500', mixed: 'text-amber-500' }

export function CallFollowUpQueue() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const telephony = useTelephony()

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/telephony/follow-up-tasks', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setTasks(data.tasks ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron cargar los seguimientos.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const finish = async (id: string, status: 'completed' | 'cancelled') => {
    const response = await fetch('/api/telephony/follow-up-tasks', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }),
    })
    if (!response.ok) { toast.error('No se pudo actualizar el seguimiento.'); return }
    setTasks((items) => items.filter((task) => task.id !== id))
  }

  return <div className="space-y-3">
    {loading ? <p className="text-sm text-muted-foreground">Cargando seguimientos…</p> : tasks.length ? tasks.map((task) => {
      const contact = task.conversation?.contact
      const analysis = task.latest_analysis
      const label = contact?.name || contact?.phone || 'Contacto'
      const sentiment = analysis?.sentiment ?? ''
      return <div key={task.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
        <div className="min-w-50 flex-1">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">Seguimiento pendiente desde {new Date(task.due_at).toLocaleString()}</p>
          {analysis ? <div className="mt-2 space-y-1 text-xs">
            <p className={sentimentClass[sentiment] ?? 'text-muted-foreground'}>
              Último análisis: {sentimentLabel[sentiment] ?? 'Sin sentimiento'}
              {analysis.sentiment_score !== null && analysis.sentiment_score !== undefined ? ` · ${analysis.sentiment_score}/100` : ''}
              {analysis.qa_score !== null && analysis.qa_score !== undefined ? ` · QA ${analysis.qa_score}/100` : ''}
            </p>
            {analysis.next_best_action ? <p className="max-w-2xl text-muted-foreground">Siguiente acción: {analysis.next_best_action}</p> : null}
          </div> : <p className="mt-2 text-xs text-muted-foreground">Sin análisis previo: atiende el seguimiento desde el historial del chat.</p>}
        </div>
        <Link className="text-xs text-primary hover:underline" href={`/inbox?c=${task.conversation_id}`}>Abrir chat</Link>
        <Button size="sm" variant="outline" disabled={!contact?.phone || !telephony.connected} onClick={() => void telephony.call(contact!.phone!)}><PhoneCall className="size-3.5" />Llamar</Button>
        <Button size="icon" variant="ghost" title="Completar" onClick={() => void finish(task.id, 'completed')}><Check className="size-4 text-emerald-500" /></Button>
        <Button size="icon" variant="ghost" title="Descartar" onClick={() => void finish(task.id, 'cancelled')}><X className="size-4 text-muted-foreground" /></Button>
      </div>
    }) : <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No tienes seguimientos pendientes.</p>}
    <Button size="sm" variant="ghost" onClick={() => { setLoading(true); void load() }}><RefreshCw className="size-3.5" />Actualizar</Button>
  </div>
}
