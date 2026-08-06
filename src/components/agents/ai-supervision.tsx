'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowUpRight, ClipboardCheck, RefreshCw, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

type SupervisedConversation = {
  conversation_id: string
  sentiment_score: number | null
  qa_score: number | null
  qa_summary: string | null
  qa_findings: string[] | null
  next_best_action: string | null
  analyzed_at: string | null
  updated_at: string
  status: string
  contact_name: string
  contact_phone: string | null
}

type Data = { conversations: SupervisedConversation[]; refreshed_at: string }

export function AiSupervisionCard() {
  const router = useRouter()
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const response = await fetch('/api/ai/supervision', { cache: 'no-store' })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? 'No se pudo cargar la supervisión.')
      setData(json)
    } catch (error) {
      if (!silent) toast.error(error instanceof Error ? error.message : 'No se pudo cargar la supervisión.')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('ai-supervision-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_conversation_analyses' }, () => void load(true))
      .subscribe()
    // Fallback for installations where Realtime is temporarily reconnecting.
    const interval = window.setInterval(() => void load(true), 30_000)
    return () => { window.clearInterval(interval); supabase.removeChannel(channel) }
  }, [load])

  const items = data?.conversations ?? []
  return <section className="rounded-xl border border-destructive/30 bg-card p-5">
    <div className="flex items-start justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-base font-semibold"><ShieldAlert className="size-4 text-destructive" />Supervisión en tiempo real</h2><p className="mt-1 text-sm text-muted-foreground">Conversaciones que el análisis identifica con sentimiento negativo.</p></div>
      <Button size="icon" variant="ghost" onClick={() => void load()} disabled={loading} title="Actualizar"><RefreshCw className={cn('size-4', loading && 'animate-spin')} /></Button>
    </div>
    {loading && !data ? <p className="mt-4 text-sm text-muted-foreground">Cargando supervisión…</p> : items.length === 0 ? <div className="mt-4 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">No hay conversaciones negativas que requieran intervención.</div> : <div className="mt-4 divide-y rounded-md border border-destructive/20">{items.map((item) => <div key={item.conversation_id} className="p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="flex items-center gap-1.5 font-medium text-foreground"><AlertTriangle className="size-3.5 shrink-0 text-destructive" />{item.contact_name}</p><p className="mt-0.5 text-xs text-muted-foreground">Sentimiento {item.sentiment_score ?? '—'}/100{item.qa_score != null ? ` · QA ${item.qa_score}/100` : ''} · {item.status === 'closed' ? 'Cerrada' : 'Abierta'}</p></div><Button size="sm" variant="outline" className="shrink-0" onClick={() => router.push(`/inbox?c=${item.conversation_id}`)}>Intervenir<ArrowUpRight className="size-3.5" /></Button></div>{item.next_best_action ? <p className="mt-2 text-xs text-muted-foreground"><b className="text-foreground">Siguiente acción:</b> {item.next_best_action}</p> : null}{item.qa_summary ? <p className="mt-1 text-xs text-muted-foreground"><ClipboardCheck className="mr-1 inline size-3 text-primary" />{item.qa_summary}</p> : null}</div>)}</div>}
  </section>
}
