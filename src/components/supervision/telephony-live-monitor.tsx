'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Headphones, Loader2, PhoneCall, Radio, RefreshCw } from 'lucide-react'
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
  agent: { name: string | null; avatarUrl: string | null } | null
}

export function TelephonyLiveMonitor() {
  const [calls, setCalls] = useState<Call[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [listeningCall, setListeningCall] = useState<string | null>(null)

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

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])
  useEffect(() => {
    const timer = window.setInterval(() => void load(true), 5_000)
    return () => window.clearInterval(timer)
  }, [load])

  const listen = async (call: Call) => {
    if (!window.confirm(`Escucharás la llamada de la extensión ${call.extension}. No podrás hablar con el agente ni con el cliente. ¿Continuar?`)) return
    const key = `${call.call_id}:${call.extension}`
    setListeningCall(key)
    try {
      const response = await fetch('/api/telephony/yeastar/live-calls/listen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: call.call_id, extension: call.extension }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      toast.success(data.message ?? 'Yeastar inició la escucha en tu extensión.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo iniciar la escucha.')
    } finally {
      setListeningCall(null)
    }
  }

  return <section className="rounded-xl border border-border bg-card p-5">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold"><Radio className="size-4 text-emerald-500" />Llamadas Yeastar en vivo</h2>
        <p className="mt-1 text-sm text-muted-foreground">Actualización automática cada 5 segundos desde el PBX y los softphones WACRM.</p>
      </div>
      <Button size="icon" variant="ghost" title="Actualizar" disabled={loading} onClick={() => void load()}><RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} /></Button>
    </div>
    {loading && calls === null ? <div className="flex h-28 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      : calls?.length ? <div className="mt-4 divide-y rounded-lg border border-border">{calls.map((call) => {
        const key = `${call.call_id}:${call.extension}`
        const pending = listeningCall === key
        return <div key={key} className="flex flex-wrap items-center gap-3 p-3">
          <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-70" /><span className="relative inline-flex size-2 rounded-full bg-emerald-500" /></span>
          <PhoneCall className="size-4 text-primary" />
          <div className="min-w-36 flex-1"><p className="text-sm font-medium">{call.agent?.name ?? `Extensión ${call.extension}`} <span className="text-muted-foreground">· {call.extension}</span></p><p className="mt-0.5 text-xs text-muted-foreground">{call.direction === 'inbound' ? 'Entrante' : call.direction === 'outbound' ? 'Saliente' : 'Llamada'} {call.peer_number ? `· ${call.peer_number}` : ''}</p></div>
          <span className="rounded-full bg-emerald-500/12 px-2 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">{call.status}</span>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => void listen(call)}>{pending ? <Loader2 className="size-4 animate-spin" /> : <Headphones className="size-4" />}Escuchar</Button>
        </div>
      })}</div>
      : <div className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No hay llamadas activas. Configura el webhook de Yeastar en <Link className="text-primary hover:underline" href="/settings?tab=telephony">Telefonía</Link> y prueba el envío desde el PBX.</div>}
  </section>
}
