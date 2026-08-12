'use client'

// Deployment marker: forces Easypanel to build the current live-call monitor revision.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Headphones, History, Loader2, MessageCircleWarning, Mic, PhoneCall, Radio, RefreshCw, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type Call = {
  call_id: string
  extension: string
  channel_id: string
  peer_number: string | null
  direction: string
  status: string
  last_event_at: string
  listenReady: boolean
  agent: { name: string | null; avatarUrl: string | null } | null
}

type AuditEntry = {
  id: string
  supervisor: string
  supervisor_extension: string
  target_extension: string
  mode: 'listen' | 'whisper' | 'barge'
  outcome: 'requested' | 'succeeded' | 'failed'
  error_message: string | null
  created_at: string
}

const modeLabel: Record<AuditEntry['mode'], string> = { listen: 'Escuchó', whisper: 'Susurró', barge: 'Intervino' }

export function TelephonyLiveMonitor() {
  const [calls, setCalls] = useState<Call[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [supervisionCall, setSupervisionCall] = useState<string | null>(null)
  const [history, setHistory] = useState<AuditEntry[] | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const response = await fetch('/api/telephony/yeastar/live-calls', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setCalls(data.calls ?? [])
    } catch (error) {
      if (!silent) toast.error(error instanceof Error ? error.message : 'No se pudieron cargar llamadas activas.')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  const loadHistory = useCallback(async (silent = false) => {
    if (!silent) setHistoryLoading(true)
    try {
      const response = await fetch('/api/telephony/yeastar/supervision-audit', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setHistory(data.entries ?? [])
    } catch (error) {
      if (!silent) toast.error(error instanceof Error ? error.message : 'No se pudo cargar el historial de supervisión.')
    } finally {
      if (!silent) setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])
  useEffect(() => {
    const timer = window.setTimeout(() => void loadHistory(), 0)
    return () => window.clearTimeout(timer)
  }, [loadHistory])
  useEffect(() => {
    const timer = window.setInterval(() => void load(true), 5_000)
    return () => window.clearInterval(timer)
  }, [load])

  const supervise = async (call: Call, mode: 'listen' | 'whisper' | 'barge') => {
    const prompt = mode === 'barge'
      ? `Intervendrás en la llamada de la extensión ${call.extension}. El agente y el cliente te escucharán. ¿Continuar?`
      : mode === 'whisper'
      ? `Hablarás solo con el agente de la extensión ${call.extension}; el cliente no te escuchará. ¿Iniciar susurro?`
      : `Escucharás la llamada de la extensión ${call.extension}. No podrás hablar con el agente ni con el cliente. ¿Continuar?`
    if (!window.confirm(prompt)) return
    const key = `${call.call_id}:${call.extension}`
    setSupervisionCall(`${key}:${mode}`)
    try {
      const response = await fetch('/api/telephony/yeastar/live-calls/listen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: call.call_id, extension: call.extension, mode }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      const label = mode === 'barge' ? 'Solicitud de intervención enviada' : mode === 'whisper' ? 'Solicitud de susurro enviada' : 'Solicitud de escucha enviada'
      toast.success(label, { description: 'Yeastar llamará a tu extensión como “Monitor”. Abre el softphone y contesta esa llamada.' })
      void loadHistory(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo iniciar la escucha.')
    } finally {
      setSupervisionCall(null)
    }
  }

  return <div className="space-y-5"><section className="rounded-xl border border-border bg-card p-5">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold"><Radio className="size-4 text-emerald-500" />Llamadas Yeastar en vivo</h2>
        <p className="mt-1 text-sm text-muted-foreground">Actualización automática cada 5 segundos desde el PBX y los softphones NexoOmni.</p>
      </div>
      <Button size="icon" variant="ghost" title="Actualizar" disabled={loading} onClick={() => void load()}><RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} /></Button>
    </div>
    {loading && calls === null ? <div className="flex h-28 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      : calls?.length ? <div className="mt-4 divide-y rounded-lg border border-border">{calls.map((call) => {
        const key = `${call.call_id}:${call.extension}`
        const pendingListen = supervisionCall === `${key}:listen`
        const pendingWhisper = supervisionCall === `${key}:whisper`
        const pendingBarge = supervisionCall === `${key}:barge`
        const pending = pendingListen || pendingWhisper || pendingBarge
        const isMonitoring = call.peer_number === 'Monitor'
        // The server verifies the PBX channel immediately before monitoring.
        // A browser/webhook synchronization delay must not block the operator.
        const canListen = !isMonitoring
        return <div key={key} className="flex flex-wrap items-center gap-3 p-3">
          <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-70" /><span className="relative inline-flex size-2 rounded-full bg-emerald-500" /></span>
          <PhoneCall className="size-4 text-primary" />
          <div className="min-w-36 flex-1"><p className="text-sm font-medium">{call.agent?.name ?? `Extensión ${call.extension}`} <span className="text-muted-foreground">· {call.extension}</span></p><p className="mt-0.5 text-xs text-muted-foreground">{call.direction === 'inbound' ? 'Entrante' : call.direction === 'outbound' ? 'Saliente' : 'Llamada'} {call.peer_number ? `· ${call.peer_number}` : ''}</p></div>
          <span className="rounded-full bg-emerald-500/12 px-2 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">{call.status}</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" title={isMonitoring ? 'Esta es tu llamada de monitoreo activa.' : 'Verificar y escuchar llamada'} disabled={pending || !canListen} onClick={() => void supervise(call, 'listen')}>{pendingListen ? <Loader2 className="size-4 animate-spin" /> : <Headphones className="size-4" />}{isMonitoring ? 'Escuchando' : pendingListen ? 'Verificando…' : 'Escuchar'}</Button>
            <Button size="sm" variant="secondary" title="Hablar solo con el agente" disabled={pending || !canListen} onClick={() => void supervise(call, 'whisper')}>{pendingWhisper ? <Loader2 className="size-4 animate-spin" /> : <Mic className="size-4" />}{pendingWhisper ? 'Verificando…' : 'Susurrar'}</Button>
            <Button size="sm" variant="destructive" title="Entrar y hablar con agente y cliente" disabled={pending || !canListen} onClick={() => void supervise(call, 'barge')}>{pendingBarge ? <Loader2 className="size-4 animate-spin" /> : <MessageCircleWarning className="size-4" />}{pendingBarge ? 'Verificando…' : 'Intervenir'}</Button>
          </div>
        </div>
      })}</div>
      : <div className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No hay llamadas activas. Configura el webhook de Yeastar en <Link className="text-primary hover:underline" href="/settings?tab=telephony">Telefonía</Link> y prueba el envío desde el PBX.</div>}
  </section>
  <section className="rounded-xl border border-border bg-card p-5">
    <div className="flex items-start justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-base font-semibold"><History className="size-4 text-primary" />Historial de supervisión</h2><p className="mt-1 text-sm text-muted-foreground">Últimas 30 acciones de escuchar, susurrar e intervenir.</p></div>
      <Button size="icon" variant="ghost" title="Actualizar historial" disabled={historyLoading} onClick={() => void loadHistory()}><RefreshCw className={historyLoading ? 'size-4 animate-spin' : 'size-4'} /></Button>
    </div>
    {history === null ? <div className="flex h-20 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      : history.length ? <div className="mt-4 divide-y rounded-lg border border-border">{history.map((entry) => <div key={entry.id} className="flex flex-wrap items-center gap-3 p-3 text-sm"><span>{entry.outcome === 'failed' ? <XCircle className="size-4 text-destructive" /> : <CheckCircle2 className="size-4 text-emerald-500" />}</span><p className="min-w-48 flex-1"><span className="font-medium">{entry.supervisor}</span> <span className="text-muted-foreground">({entry.supervisor_extension})</span> {modeLabel[entry.mode].toLowerCase()} la extensión <span className="font-medium">{entry.target_extension}</span>{entry.outcome === 'failed' ? <span className="block text-xs text-destructive">{entry.error_message ?? 'Yeastar rechazó la acción.'}</span> : null}</p><span className="text-xs text-muted-foreground">{new Date(entry.created_at).toLocaleString('es-MX')}</span></div>)}</div>
        : <p className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Aún no hay acciones de supervisión registradas.</p>}
  </section></div>
}
