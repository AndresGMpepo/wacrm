'use client'

import { useCallback, useEffect, useState } from 'react'
import { Download, History, LoaderCircle, Phone, UserCheck } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type TraceEvent = {
  at: string
  type: string
  agent: string | null
  agent_id: string | null
  contact: string | null
  contact_id: string | null
  channel: string | null
  conversation_id: string | null
  detail: string
}

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  zernio_whatsapp: 'WhatsApp conectado',
  zernio_facebook: 'Facebook conectado',
  zernio_instagram: 'Instagram conectado',
  facebook: 'Facebook',
  instagram: 'Instagram',
  yeastar_live_chat: 'Chat web',
  tiktok: 'TikTok',
  'telefonía': 'Telefonía',
}

const RANGES = [
  { value: '1', label: 'Últimas 24 horas' },
  { value: '7', label: 'Últimos 7 días' },
  { value: '30', label: 'Últimos 30 días' },
  { value: '90', label: 'Últimos 90 días' },
]

/** Who attended whom, across chat and phone — the supervisor's audit view. */
export function TraceabilityLog() {
  const [events, setEvents] = useState<TraceEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState('7')
  const [channel, setChannel] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ days, limit: '200' })
      if (channel !== 'all') params.set('channel', channel)
      const res = await fetch(`/api/supervision/trace?${params}`, { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body?.error ?? 'No se pudo cargar la trazabilidad.')
        return
      }
      setEvents(body.events ?? [])
    } finally {
      setLoading(false)
    }
  }, [days, channel])

  useEffect(() => {
    void load()
  }, [load])

  const download = () => {
    const params = new URLSearchParams({ days, limit: '500', format: 'csv' })
    if (channel !== 'all') params.set('channel', channel)
    window.open(`/api/supervision/trace?${params}`, '_blank')
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="size-4 text-primary" />
            Trazabilidad de atención
          </CardTitle>
          <CardDescription>
            Cada asignación, transferencia y llamada: quién atendió, por qué canal y cuándo.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={days} onValueChange={(value) => setDays(value ?? '7')}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RANGES.map((range) => (
                <SelectItem key={range.value} value={range.value}>{range.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={channel} onValueChange={(value) => setChannel(value ?? 'all')}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los canales</SelectItem>
              {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={download} disabled={events.length === 0}>
            <Download className="size-4" />
            CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8">
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : events.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Sin movimientos registrados en este período.
          </p>
        ) : (
          <ol className="max-h-[28rem] space-y-1.5 overflow-y-auto pr-1">
            {events.map((event, index) => {
              const Icon = event.type === 'call' ? Phone : UserCheck
              return (
                <li
                  key={`${event.at}-${index}`}
                  className="flex gap-3 rounded-md border border-border bg-muted/20 px-3 py-2"
                >
                  <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-sm font-medium text-foreground">{event.agent ?? 'Sin agente'}</span>
                      {event.contact ? (
                        <span className="text-xs text-muted-foreground">· {event.contact}</span>
                      ) : null}
                      {event.channel ? (
                        <span className="rounded-full border border-border px-1.5 text-[10px] text-muted-foreground">
                          {CHANNEL_LABELS[event.channel] ?? event.channel}
                        </span>
                      ) : null}
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(event.at).toLocaleString()}
                      </span>
                    </div>
                    <p className="break-words text-xs text-muted-foreground">{event.detail}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
