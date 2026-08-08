'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, UserRoundCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type Intervention = {
  conversation_id: string
  contact_name: string
  sentiment_score: number | null
  next_best_action: string | null
  intervention_status: 'pending' | 'in_progress' | 'resolved'
  started_by_user_id: string | null
}

export function CriticalInterventionQueue() {
  const router = useRouter()
  const [items, setItems] = useState<Intervention[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [actingOn, setActingOn] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const response = await fetch('/api/supervision/interventions', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'No se pudo cargar la cola de intervención.')
      setItems(data.items ?? [])
    } catch (error) {
      if (!silent) toast.error(error instanceof Error ? error.message : 'No se pudo cargar la cola de intervención.')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const timer = window.setInterval(() => void load(true), 15_000)
    return () => window.clearInterval(timer)
  }, [load])

  const act = async (item: Intervention, action: 'claim' | 'resolve') => {
    setActingOn(`${item.conversation_id}:${action}`)
    try {
      const response = await fetch('/api/supervision/interventions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: item.conversation_id, action }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'No se pudo actualizar el seguimiento.')
      toast.success(action === 'claim' ? 'Seguimiento tomado.' : 'Seguimiento resuelto.')
      await load(true)
      if (action === 'claim') router.push(`/inbox?c=${item.conversation_id}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar el seguimiento.')
    } finally {
      setActingOn(null)
    }
  }

  const pending = items?.filter((item) => item.intervention_status === 'pending').length ?? 0
  const active = items?.filter((item) => item.intervention_status === 'in_progress').length ?? 0

  return (
    <section className="rounded-xl border border-destructive/30 bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="flex items-center gap-2 text-base font-semibold"><AlertTriangle className="size-4 text-destructive" />Cola de intervención prioritaria</h2><p className="mt-1 text-sm text-muted-foreground">Alertas negativas abiertas con responsable y resolución trazable.</p></div>
        <Button size="icon" variant="ghost" title="Actualizar" disabled={loading} onClick={() => void load()}><RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} /></Button>
      </div>
      <div className="mt-4 flex gap-2 text-xs"><span className="rounded-full bg-destructive/10 px-2 py-1 font-medium text-destructive">{pending} pendientes</span><span className="rounded-full bg-primary/10 px-2 py-1 font-medium text-primary">{active} en seguimiento</span></div>
      {loading && !items ? <div className="flex h-24 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div> : items?.length ? <div className="mt-4 divide-y rounded-lg border border-border">{items.map((item) => {
        const busy = actingOn?.startsWith(`${item.conversation_id}:`)
        return <div key={item.conversation_id} className="flex flex-wrap items-center gap-3 p-3"><div className="min-w-48 flex-1"><p className="font-medium">{item.contact_name}</p><p className="mt-0.5 text-xs text-muted-foreground">Sentimiento {item.sentiment_score ?? '—'}/100{item.next_best_action ? ` · ${item.next_best_action}` : ''}</p></div><Status status={item.intervention_status} /><Button size="sm" variant="outline" onClick={() => router.push(`/inbox?c=${item.conversation_id}`)}>Abrir chat</Button>{item.intervention_status === 'pending' ? <Button size="sm" variant="destructive" disabled={busy} onClick={() => void act(item, 'claim')}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <UserRoundCheck className="size-3.5" />}Tomar</Button> : item.intervention_status === 'in_progress' ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(item, 'resolve')}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}Resolver</Button> : null}</div>
      })}</div> : <p className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No hay alertas críticas abiertas.</p>}
    </section>
  )
}

function Status({ status }: { status: Intervention['intervention_status'] }) {
  if (status === 'pending') return <span className="rounded-full bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive">Pendiente</span>
  if (status === 'in_progress') return <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">En seguimiento</span>
  return <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-500">Resuelta</span>
}
