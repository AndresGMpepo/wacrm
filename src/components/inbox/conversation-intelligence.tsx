'use client'

import { useCallback, useEffect, useState } from 'react'
import { BrainCircuit, RefreshCw, Smile, Frown, Meh, MessageCircleQuestion } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Analysis = {
  summary: string | null
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed' | null
  sentiment_score: number | null
  next_best_action: string | null
  reasons: string[] | null
  analyzed_message_count: number
  analyzed_at: string | null
}

const sentimentMeta = {
  positive: { label: 'Positivo', icon: Smile, className: 'text-emerald-500' },
  neutral: { label: 'Neutral', icon: Meh, className: 'text-sky-500' },
  negative: { label: 'Negativo', icon: Frown, className: 'text-red-500' },
  mixed: { label: 'Mixto', icon: MessageCircleQuestion, className: 'text-amber-500' },
} as const

export function ConversationIntelligence({ conversationId }: { conversationId: string }) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/ai/conversation-analysis/${conversationId}`)
      const data = await response.json()
      if (response.ok) setAnalysis(data.analysis)
    } finally {
      setLoading(false)
    }
  }, [conversationId])

  useEffect(() => { void load() }, [load])

  const analyze = async () => {
    setRunning(true)
    try {
      const response = await fetch(`/api/ai/conversation-analysis/${conversationId}`, { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'No se pudo analizar la conversación.')
      setAnalysis(data.analysis)
      toast.success('Análisis actualizado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo analizar la conversación.')
    } finally {
      setRunning(false)
    }
  }

  const meta = analysis?.sentiment ? sentimentMeta[analysis.sentiment] : null
  const Icon = meta?.icon ?? BrainCircuit

  return (
    <section className="border-t border-border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className={cn('size-4 shrink-0', meta?.className ?? 'text-primary')} />
          <p className="text-sm font-medium">Inteligencia de conversación</p>
          {meta ? <span className={cn('text-xs font-medium', meta.className)}>{meta.label}{analysis?.sentiment_score != null ? ` · ${analysis.sentiment_score}/100` : ''}</span> : null}
        </div>
        <Button size="sm" variant="ghost" onClick={() => void analyze()} disabled={running || loading}>
          <RefreshCw className={cn('size-3.5', running && 'animate-spin')} />
          {analysis ? 'Actualizar' : 'Analizar'}
        </Button>
      </div>
      {loading ? <p className="mt-2 text-xs text-muted-foreground">Cargando análisis…</p> : analysis ? <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
        {analysis.summary ? <p><span className="font-medium text-foreground">Resumen:</span> {analysis.summary}</p> : null}
        {analysis.next_best_action ? <p><span className="font-medium text-foreground">Siguiente acción:</span> {analysis.next_best_action}</p> : null}
        {analysis.reasons?.length ? <p>{analysis.reasons.join(' · ')}</p> : null}
      </div> : <p className="mt-2 text-xs text-muted-foreground">Genera un resumen, sentimiento y siguiente acción para este chat.</p>}
    </section>
  )
}
