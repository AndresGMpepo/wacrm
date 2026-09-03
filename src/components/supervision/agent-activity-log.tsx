'use client'

import { useCallback, useEffect, useState } from 'react'
import { Activity, Download, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDuration } from '@/lib/supervision/performance'

type ActivityEvent = {
  id: string
  action: string
  entity_type: string
  agent: string | null
  contact: string | null
  details: Record<string, unknown>
  created_at: string
}

type PerformanceRow = {
  user_id: string
  agent: string
  messages_sent: number
  conversations_handled: number
  conversations_closed: number
  transfers_sent: number
  transfers_received: number
  calls: number
  notes: number
  appointments_created: number
  tags_applied: number
  first_response_median_seconds: number | null
  first_response_samples: number
  resolution_median_seconds: number | null
  resolution_samples: number
  online_seconds: number
}

const ACTION_LABELS: Record<string, string> = {
  conversation_closed: 'Cerró la conversación',
  conversation_reopened: 'Reabrió la conversación',
  conversation_status_changed: 'Cambió el estado',
  conversation_assigned: 'Asignó la conversación',
  conversation_released: 'Liberó la conversación',
  ai_paused: 'Tomó el control de la IA',
  ai_resumed: 'Devolvió el chat a la IA',
  contact_created: 'Creó el contacto',
  contact_archived: 'Archivó el contacto',
  contact_restored: 'Restauró el contacto',
  tag_added: 'Agregó una etiqueta',
  tag_removed: 'Quitó una etiqueta',
  note_added: 'Agregó una nota',
  deal_created: 'Creó un trato',
  deal_stage_changed: 'Movió un trato de etapa',
  deal_status_changed: 'Cambió el estado del trato',
  appointment_created: 'Creó una cita',
  appointment_status_changed: 'Cambió el estado de la cita',
  appointment_rescheduled: 'Reagendó una cita',
}

const RANGES = [
  { value: '1', label: 'Últimas 24 horas' },
  { value: '7', label: 'Últimos 7 días' },
  { value: '30', label: 'Últimos 30 días' },
  { value: '90', label: 'Últimos 90 días' },
]

/** What the team actually did, and how much of it — the two questions a
 *  supervisor asks that the conversation list can't answer. */
export function AgentActivityLog() {
  const [days, setDays] = useState('7')
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [rows, setRows] = useState<PerformanceRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [activityRes, performanceRes] = await Promise.all([
        fetch(`/api/supervision/activity?days=${days}&limit=200`, { cache: 'no-store' }),
        fetch(`/api/supervision/performance?days=${days}`, { cache: 'no-store' }),
      ])
      const activity = await activityRes.json().catch(() => ({}))
      const performance = await performanceRes.json().catch(() => ({}))
      if (!activityRes.ok || !performanceRes.ok) {
        toast.error(activity?.error ?? performance?.error ?? 'No se pudo cargar la actividad.')
        return
      }
      setEvents(activity.events ?? [])
      setRows(performance.rows ?? [])
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="size-4 text-primary" />
            Actividad y desempeño de agentes
          </CardTitle>
          <CardDescription>
            Cada acción registrada por su autor. Lo que no tiene agente lo hizo el sistema (IA, automatización o enrutamiento).
          </CardDescription>
        </div>
        <Select value={days} onValueChange={(value) => setDays(value ?? '7')}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            {RANGES.map((range) => (
              <SelectItem key={range.value} value={range.value}>{range.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8">
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="performance">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <TabsList>
                <TabsTrigger value="performance">Desempeño</TabsTrigger>
                <TabsTrigger value="activity">Bitácora</TabsTrigger>
              </TabsList>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(`/api/supervision/performance?days=${days}&format=csv`, '_blank')}
                  disabled={rows.length === 0}
                >
                  <Download className="size-4" />
                  Desempeño
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(`/api/supervision/activity?days=${days}&limit=500&format=csv`, '_blank')}
                  disabled={events.length === 0}
                >
                  <Download className="size-4" />
                  Bitácora
                </Button>
              </div>
            </div>

            <TabsContent value="performance">
              {rows.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Sin actividad de agentes en este período.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[64rem] text-sm">
                    <thead>
                      <tr className="border-border border-b text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Agente</th>
                        <th className="px-2 py-2 text-right font-medium">Conectado</th>
                        <th className="px-2 py-2 text-right font-medium">1.ª respuesta</th>
                        <th className="px-2 py-2 text-right font-medium">Resolución</th>
                        <th className="px-2 py-2 text-right font-medium">Mensajes</th>
                        <th className="px-2 py-2 text-right font-medium">Chats atendidos</th>
                        <th className="px-2 py-2 text-right font-medium">Cerrados</th>
                        <th className="px-2 py-2 text-right font-medium">Transf. enviadas</th>
                        <th className="px-2 py-2 text-right font-medium">Transf. recibidas</th>
                        <th className="px-2 py-2 text-right font-medium">Llamadas</th>
                        <th className="px-2 py-2 text-right font-medium">Notas</th>
                        <th className="px-2 py-2 text-right font-medium">Citas</th>
                        <th className="pl-2 py-2 text-right font-medium">Etiquetas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.user_id} className="border-border/60 border-b last:border-0">
                          <td className="py-2 pr-3 font-medium text-foreground">{row.agent}</td>
                          <td className="px-2 py-2 text-right">{formatDuration(row.online_seconds || null)}</td>
                          <td className="px-2 py-2 text-right" title={`${row.first_response_samples} respuestas medidas`}>
                            {formatDuration(row.first_response_median_seconds)}
                          </td>
                          <td className="px-2 py-2 text-right" title={`${row.resolution_samples} cierres medidos`}>
                            {formatDuration(row.resolution_median_seconds)}
                          </td>
                          <td className="px-2 py-2 text-right">{row.messages_sent}</td>
                          <td className="px-2 py-2 text-right">{row.conversations_handled}</td>
                          <td className="px-2 py-2 text-right">{row.conversations_closed}</td>
                          <td className="px-2 py-2 text-right">{row.transfers_sent}</td>
                          <td className="px-2 py-2 text-right">{row.transfers_received}</td>
                          <td className="px-2 py-2 text-right">{row.calls}</td>
                          <td className="px-2 py-2 text-right">{row.notes}</td>
                          <td className="px-2 py-2 text-right">{row.appointments_created}</td>
                          <td className="pl-2 py-2 text-right">{row.tags_applied}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="activity">
              {events.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Sin movimientos registrados en este período.
                </p>
              ) : (
                <ol className="max-h-[28rem] space-y-1.5 overflow-y-auto pr-1">
                  {events.map((event) => (
                    <li
                      key={event.id}
                      className="border-border bg-muted/20 rounded-md border px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-sm font-medium text-foreground">
                          {event.agent ?? 'Sistema'}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {ACTION_LABELS[event.action] ?? event.action}
                        </span>
                        {event.contact ? (
                          <span className="text-xs text-muted-foreground">· {event.contact}</span>
                        ) : null}
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(event.created_at).toLocaleString()}
                        </span>
                      </div>
                      {event.details && Object.keys(event.details).length > 0 ? (
                        <p className="break-words text-[11px] text-muted-foreground">
                          {Object.entries(event.details)
                            .filter(([, value]) => value !== null && value !== undefined && value !== '')
                            .map(([key, value]) => `${key}: ${String(value)}`)
                            .join(' · ')}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  )
}
