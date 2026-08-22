'use client'

import { useEffect, useState } from 'react'
import { Loader2, PhoneCall, RefreshCw } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

type CallRecord = {
  id: string
  call_id: string
  customer_phone: string | null
  customer_name: string | null
  customer_email: string | null
  agent_extension: string | null
  direction: string | null
  started_at: string | null
  ended_at: string | null
  duration_seconds: number | null
  recording_url: string | null
  transcript: string | null
  summary: string | null
  transcription_status: string
  error_message: string | null
  yeastar_payload: unknown
  contact: { name: string | null; phone: string; email: string | null } | null
  agent: { full_name: string | null; email: string | null } | null
}

function date(value: string | null) { return value ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Sin fecha' }
function duration(value: number | null) { if (value == null) return 'Sin datos'; return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}` }

export default function CallTranscriptionsPage() {
  const { accountRole } = useAuth()
  const allowed = accountRole === 'owner' || accountRole === 'admin'
  const [calls, setCalls] = useState<CallRecord[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const response = await fetch(`/api/telephony/yeastar/transcriptions${query ? `?q=${encodeURIComponent(query)}` : ''}`, { cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'No se pudieron cargar las transcripciones.')
      setCalls(payload.calls ?? [])
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudieron cargar las transcripciones.') }
    finally { setLoading(false) }
  }

  useEffect(() => { if (allowed) void load() }, [allowed])
  if (!allowed) return <Card><CardHeader><CardTitle>Acceso restringido</CardTitle><CardDescription>Solo propietarios y administradores pueden consultar transcripciones de llamadas.</CardDescription></CardHeader></Card>

  return <div className="space-y-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><PhoneCall className="size-6 text-primary" />Transcripciones y resúmenes</h1><p className="mt-1 text-sm text-muted-foreground">Resultados de AI Call Transcription sincronizados desde Yeastar.</p></div><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} />Actualizar</Button></div>
    <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void load() }}><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por cliente, número o texto" /><Button type="submit">Buscar</Button></form>
    {loading ? <div className="flex justify-center py-12 text-muted-foreground"><Loader2 className="mr-2 size-5 animate-spin" />Cargando</div> : error ? <Card><CardContent className="pt-6 text-sm text-red-400">{error}</CardContent></Card> : calls.length === 0 ? <Card><CardContent className="pt-6 text-sm text-muted-foreground">Aún no hay llamadas sincronizadas. Confirma que Yeastar envía el evento 30012 después de finalizar una llamada.</CardContent></Card> : <div className="space-y-4">{calls.map((call) => <Card key={call.id}><CardHeader><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle className="text-base">{call.contact?.name || call.customer_name || call.customer_phone || 'Cliente sin identificar'}</CardTitle><CardDescription>{call.contact?.phone || call.customer_phone || 'Sin número'}{call.contact?.email || call.customer_email ? ` · ${call.contact?.email || call.customer_email}` : ''} · {call.agent?.full_name || 'Agente no identificado'}{call.agent_extension ? ` · Ext. ${call.agent_extension}` : ''}</CardDescription></div><span className="text-xs text-muted-foreground">{date(call.ended_at || call.started_at)} · {duration(call.duration_seconds)} · {call.direction || 'unknown'}</span></div></CardHeader><CardContent className="space-y-4">{call.recording_url ? <audio controls preload="none" className="w-full" src={call.recording_url} /> : null}{call.transcription_status === 'failed' ? <p className="text-sm text-red-400">{call.error_message || 'La sincronización de IA falló.'}</p> : null}{call.transcription_status === 'pending' ? <p className="text-sm text-amber-400">Yeastar aún no publica la transcripción/resumen IA de esta llamada. Se reintenta automáticamente cada minuto.</p> : null}{call.transcription_status === 'unavailable' ? <p className="text-sm text-muted-foreground">Yeastar no generó transcripción ni resumen IA para esta llamada dentro del tiempo esperado.</p> : null}<div><h2 className="text-sm font-semibold">Resumen</h2><p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{call.summary || 'Sin resumen disponible.'}</p></div><details><summary className="cursor-pointer text-sm font-semibold">Ver transcripción</summary><p className="mt-2 whitespace-pre-wrap border-l-2 border-primary/30 pl-3 text-sm leading-6 text-muted-foreground">{call.transcript || 'Sin transcripción disponible.'}</p></details><details><summary className="cursor-pointer text-xs text-muted-foreground">Datos técnicos (depuración)</summary><pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted/30 p-3 text-xs">{JSON.stringify(call.yeastar_payload, null, 2)}</pre></details></CardContent></Card>)}</div>}
  </div>
}
