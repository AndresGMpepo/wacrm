'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { hasMinRole } from '@/lib/auth/roles'
import { ChevronLeft, ChevronRight, Frown, Loader2, Meh, MessageCircleQuestion, PhoneCall, RefreshCw, Smile } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

type TimelineEvent = { name: string; timeSeconds: number; at: string | null; content: unknown }
type TimelineLeg = { leg: number; events: TimelineEvent[] }

type CallRecord = {
  id: string
  call_id: string
  session_call_id: string
  customer_phone: string | null
  customer_name: string | null
  customer_email: string | null
  agent_extension: string | null
  agent_name: string | null
  direction: string | null
  started_at: string | null
  ended_at: string | null
  duration_seconds: number | null
  routing_duration_seconds: number | null
  handling_duration_seconds: number | null
  ring_duration_seconds: number | null
  hold_duration_seconds: number | null
  talk_duration_seconds: number | null
  disconnected_by: string | null
  timeline: TimelineLeg[] | null
  transcript: string | null
  summary: string | null
  key_points: string[] | null
  action_items: Array<{ description: string; owner: 'agent' | 'customer'; due_date: string | null }> | null
  transcription_status: string
  analysis_status: string
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed' | null
  sentiment_score: number | null
  memory_applied_at: string | null
  ai_first_touch: boolean
  ai_handoff: {
    summary: string
    customer_need: string | null
    next_action: string | null
    created_at: string
  } | null
  error_message: string | null
  contact: { name: string | null; phone: string; email: string | null } | null
  agent: { full_name: string | null; email: string | null } | null
}

function date(value: string | null) { return value ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Sin fecha' }
function dueDate(value: string | null) { return value ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date(value)) : '' }
function duration(value: number | null) { if (value == null) return 'Sin datos'; return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}` }

const SENTIMENT_META = {
  positive: { label: 'Positivo', icon: Smile, className: 'text-emerald-500' },
  neutral: { label: 'Neutral', icon: Meh, className: 'text-sky-500' },
  negative: { label: 'Negativo', icon: Frown, className: 'text-red-500' },
  mixed: { label: 'Mixto', icon: MessageCircleQuestion, className: 'text-amber-500' },
} as const

function SentimentBadge({ sentiment, score }: { sentiment: CallRecord['sentiment']; score: CallRecord['sentiment_score'] }) {
  if (!sentiment) return null
  const meta = SENTIMENT_META[sentiment]
  const Icon = meta.icon
  return <span className={`flex items-center gap-1 text-xs font-medium ${meta.className}`}>
    <Icon className="size-3.5" />{meta.label}{score != null ? ` (${score})` : ''}
  </span>
}

const EVENT_LABELS: Record<string, (data: Record<string, unknown> | null) => string> = {
  call_to: (data) => data?.to ? `Llamada a ${data.to}` : 'Llamada iniciada',
  tried_contact: (data) => data?.to ? `Se intentó contactar con ${data.to}` : 'Intento de contacto',
  answered: (data) => data?.to ? `${data.to} respondió la llamada` : 'Llamada contestada',
  hangup: (data) => data?.from ? `${data.from} colgó la llamada` : 'Llamada finalizada',
  callnote: () => 'Nota de llamada registrada',
}

function parseEventContent(content: unknown): Record<string, unknown> | null {
  if (!content) return null
  if (typeof content === 'string') { try { return JSON.parse(content) } catch { return null } }
  if (typeof content === 'object') return content as Record<string, unknown>
  return null
}

function describeEvent(event: TimelineEvent): string {
  const data = parseEventContent(event.content)
  const label = EVENT_LABELS[event.name]
  return label ? label(data) : event.name
}

/** Segmented bar mirroring Yeastar's wait/talk/hold breakdown, built from the seconds we already store — no chart library needed. */
function TimeBreakdown({ call }: { call: CallRecord }) {
  const total = call.duration_seconds ?? 0
  const segments = [
    { label: 'Espera', seconds: call.ring_duration_seconds, color: 'bg-emerald-500' },
    { label: 'Conversación', seconds: call.talk_duration_seconds, color: 'bg-amber-500' },
    { label: 'Retención', seconds: call.hold_duration_seconds, color: 'bg-sky-500' },
  ].filter((segment) => segment.seconds != null && segment.seconds > 0) as { label: string; seconds: number; color: string }[]
  if (!total || !segments.length) return null
  return <div className="space-y-2">
    <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
      <div><span className="font-medium text-foreground">{duration(call.duration_seconds)}</span> total</div>
      <div><span className="font-medium text-foreground">{duration(call.routing_duration_seconds)}</span> enrutamiento</div>
      <div><span className="font-medium text-foreground">{duration(call.handling_duration_seconds)}</span> gestión</div>
    </div>
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
      {segments.map((segment) => <div key={segment.label} className={segment.color} style={{ width: `${(segment.seconds / total) * 100}%` }} title={`${segment.label}: ${duration(segment.seconds)}`} />)}
    </div>
    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
      {segments.map((segment) => <span key={segment.label} className="flex items-center gap-1"><span className={`size-2 rounded-full ${segment.color}`} />{segment.label} · {duration(segment.seconds)}</span>)}
    </div>
  </div>
}

function Chronology({ timeline }: { timeline: TimelineLeg[] | null }) {
  if (!timeline || !timeline.length) return null
  return <div className="space-y-3">
    {timeline.map((leg) => <div key={leg.leg} className="space-y-1">
      {timeline.length > 1 ? <p className="text-xs font-medium text-muted-foreground">Tramo {leg.leg}</p> : null}
      <ol className="space-y-1 border-l-2 border-primary/20 pl-3 text-sm">
        {leg.events.map((event, index) => <li key={`${leg.leg}-${index}`} className="text-muted-foreground">
          <span className="mr-2 text-xs tabular-nums">{duration(event.timeSeconds)}</span>{describeEvent(event)}
        </li>)}
      </ol>
    </div>)}
  </div>
}

function CallTranscriptionsContent() {
  const t = useTranslations('CallTranscriptionSync')
  const searchParams = useSearchParams()
  const { accountRole } = useAuth()
  const allowed = !!accountRole && hasMinRole(accountRole, 'supervisor')
  const [calls, setCalls] = useState<CallRecord[]>([])
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [page, setPage] = useState(1)
  const [onlyTranscribed, setOnlyTranscribed] = useState(true)
  const [pagination, setPagination] = useState({ page: 1, page_size: 25, total: 0, total_pages: 1 })
  const requestedCallId = searchParams.get('call')?.trim() ?? ''
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [syncPhone, setSyncPhone] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (requestedCallId) params.set('call', requestedCallId)
      else {
        params.set('page', String(page))
        params.set('page_size', '25')
        if (appliedQuery) params.set('q', appliedQuery)
        params.set('only_transcribed', String(onlyTranscribed))
      }
      const response = await fetch(`/api/telephony/yeastar/transcriptions${params.size ? `?${params.toString()}` : ''}`, { cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'No se pudieron cargar las transcripciones.')
      setCalls(payload.calls ?? [])
      if (payload.pagination) setPagination(payload.pagination)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudieron cargar las transcripciones.') }
    finally { if (!quiet) setLoading(false) }
  }, [appliedQuery, onlyTranscribed, page, requestedCallId])

  const archiveErrorMessage = (code?: string) => {
    switch (code) {
      case 'yeastar_connection_unavailable': return t('importErrorConnection')
      case 'yeastar_export_unreachable': return t('importErrorQuery')
      case 'yeastar_export_rejected': return t('importErrorRejected')
      case 'yeastar_invalid_download': return t('importErrorInvalidDownload')
      case 'yeastar_download_unreachable':
      case 'yeastar_download_failed': return t('importErrorDownload')
      case 'yeastar_empty_export':
      case 'yeastar_invalid_export': return t('importErrorInvalidExport')
      case 'yeastar_export_too_large': return t('importErrorTooLarge')
      case 'transcript_database_error': return t('importErrorDatabase')
      case 'invalid_phone':
      case 'invalid_request': return t('importErrorInput')
      default: return t('importError')
    }
  }

  const sync = async () => {
    setSyncing(true)
    setSyncMessage(null)
    setSyncError(null)
    try {
      const response = await fetch('/api/telephony/yeastar/transcriptions/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: syncPhone }),
      })
      const result = await response.json() as { imported?: number; updated?: number; dated?: number; remaining?: number; available?: number; alreadyPresent?: number; undated?: number; code?: string }
      if (!response.ok) {
        setSyncError(archiveErrorMessage(result.code))
        return
      }
      setSyncMessage(result.imported || result.updated
        ? t('importSuccess', { count: result.imported ?? 0, updated: result.updated ?? 0 })
          + (result.dated ? ` ${t('importDated', { count: result.dated })}` : '')
          + (result.undated ? ` ${t('importUndated', { count: result.undated })}` : '')
          + (result.remaining ? ` ${t('remaining', { count: result.remaining })}` : '')
        : result.available === 0
          ? t('noPublishedTranscripts')
          : t('nothingToImport', { count: result.alreadyPresent ?? 0 }))
      if (page !== 1) setPage(1)
      else await load(true)
    } catch (reason) {
      console.error('[yeastar] manual transcript sync failed:', reason)
      setSyncError(t('importError'))
    } finally { setSyncing(false) }
  }

  useEffect(() => { if (allowed) void load() }, [allowed, load])
  if (!allowed) return <Card><CardHeader><CardTitle>{t('restrictedTitle')}</CardTitle><CardDescription>{t('restrictedDescription')}</CardDescription></CardHeader></Card>

  return <div className="space-y-6">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><PhoneCall className="size-6 text-primary" />{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      </div>
      <div className="w-full space-y-2 lg:max-w-2xl">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={syncPhone} onChange={(event) => setSyncPhone(event.target.value)} placeholder={t('phone')} aria-label={t('phone')} />
          <Button className="shrink-0" onClick={() => void sync()} disabled={syncing}>{syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{t(syncing ? 'syncing' : 'sync')}</Button>
        </div>
        <p className="text-xs text-muted-foreground">{t('importHelp')}</p>
        {syncMessage ? <p role="status" className="text-sm text-muted-foreground">{syncMessage}</p> : null}
        {syncError ? <p role="alert" className="text-sm text-destructive">{syncError}</p> : null}
      </div>
      <Button variant="outline" onClick={async () => { setRefreshing(true); try { await load(true) } finally { setRefreshing(false) } }} disabled={loading || refreshing}><RefreshCw className={refreshing ? 'size-4 animate-spin' : 'size-4'} />Actualizar</Button>
    </div>
    {!requestedCallId ? <div className="space-y-2">
      <form className="flex gap-2" onSubmit={(event) => {
        event.preventDefault()
        const nextQuery = query.trim()
        if (page === 1 && nextQuery === appliedQuery) void load()
        else {
          setPage(1)
          setAppliedQuery(nextQuery)
        }
      }}>
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('searchPlaceholder')} />
        <Button type="submit">{t('search')}</Button>
      </form>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          className="size-4"
          checked={onlyTranscribed}
          onChange={(event) => { setOnlyTranscribed(event.target.checked); setPage(1) }}
        />
        {t('onlyTranscribedLabel')}
      </label>
    </div> : null}
    {loading
      ? <div className="flex justify-center py-12 text-muted-foreground"><Loader2 className="mr-2 size-5 animate-spin" />Cargando</div>
      : error
        ? <Card><CardContent className="pt-6 text-sm text-red-400">{error}</CardContent></Card>
        : calls.length === 0
          ? <Card><CardContent className="pt-6 text-sm text-muted-foreground">{requestedCallId ? t('selectedCallNotFound') : onlyTranscribed ? t('noTranscribedCalls') : 'Aún no hay llamadas sincronizadas. Confirma que Yeastar envía el evento 30012 después de finalizar una llamada.'}</CardContent></Card>
          : <div className="space-y-4">
            {calls.map((call) => <Card key={call.id}>
              <CardHeader>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle className="text-base">{call.contact?.name || call.customer_name || call.customer_phone || 'Cliente sin identificar'}</CardTitle>
                    <CardDescription>
                      {call.contact?.phone || call.customer_phone || 'Sin número'}
                      {call.contact?.email || call.customer_email ? ` · ${call.contact?.email || call.customer_email}` : ''}
                      {' · '}{call.agent?.full_name || call.agent_name || (call.agent_extension ? t('extensionAgent', { extension: call.agent_extension }) : t('agentUnidentified'))}
                      {call.agent_extension ? ` · ${t('extensionShort')} ${call.agent_extension}` : ''}
                    </CardDescription>
                    {call.ai_first_touch ? <p className="mt-1 text-xs font-medium text-primary">{t('aiFirstTouch')}</p> : null}
                  </div>
                  <span className="text-xs text-muted-foreground">{date(call.ended_at || call.started_at)} · {duration(call.duration_seconds)} · {call.direction || 'unknown'}</span>
                </div>
                <SentimentBadge sentiment={call.sentiment} score={call.sentiment_score} />
              </CardHeader>
              <CardContent className="space-y-4">
                {call.transcription_status === 'failed' ? <p className="text-sm text-red-400">{t('transcriptFailed')}</p> : null}
                {call.transcription_status === 'pending' ? <p className="text-sm text-amber-400">{t('transcriptPending')}</p> : null}
                {call.transcription_status === 'unavailable' ? <p className="text-sm text-muted-foreground">{t('transcriptUnavailable')}</p> : null}
                {call.transcription_status === 'completed'
                  && call.analysis_status !== 'completed'
                  && !call.memory_applied_at
                  && !call.summary
                  ? <p className="text-sm text-amber-500">{t(call.analysis_status === 'failed' ? 'analysisFailed' : call.analysis_status === 'unavailable' ? 'analysisUnavailable' : 'analysisPending')}</p>
                  : null}
                {call.analysis_status === 'completed' && !call.memory_applied_at
                  ? <p className="text-sm text-amber-500">{t('memoryNotLinked')}</p>
                  : null}
                <TimeBreakdown call={call} />
                {call.ai_handoff ? <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                  <h2 className="text-sm font-semibold">{t('aiHandoffTitle')}</h2>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{call.ai_handoff.summary}</p>
                  {call.ai_handoff.customer_need ? <p className="mt-1 text-xs text-muted-foreground">{t('aiCustomerNeed', { need: call.ai_handoff.customer_need })}</p> : null}
                  {call.ai_handoff.next_action ? <p className="mt-1 text-xs text-muted-foreground">{t('aiNextAction', { action: call.ai_handoff.next_action })}</p> : null}
                </div> : null}
                <div>
                  <h2 className="text-sm font-semibold">Resumen</h2>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{call.summary || 'Sin resumen disponible.'}</p>
                </div>
                {call.key_points?.length ? <div>
                  <h2 className="text-sm font-semibold">Puntos clave</h2>
                  <ul className="mt-1 list-inside list-disc text-sm text-muted-foreground">{call.key_points.map((point, index) => <li key={index}>{point}</li>)}</ul>
                </div> : null}
                {call.action_items?.length ? <div>
                  <h2 className="text-sm font-semibold">Pendientes</h2>
                  <ul className="mt-1 space-y-1 text-sm text-muted-foreground">{call.action_items.map((item, index) => <li key={index}>{item.description}{item.due_date ? ` · ${dueDate(item.due_date)}` : ''}{item.owner === 'customer' ? ' (cliente)' : ''}</li>)}</ul>
                </div> : null}
                <details>
                  <summary className="cursor-pointer text-sm font-semibold">Ver transcripción</summary>
                  <p className="mt-2 whitespace-pre-wrap border-l-2 border-primary/30 pl-3 text-sm leading-6 text-muted-foreground">{call.transcript || 'Sin transcripción disponible.'}</p>
                </details>
                {call.timeline?.length ? <details>
                  <summary className="cursor-pointer text-sm font-semibold">Ver cronología</summary>
                  <div className="mt-2"><Chronology timeline={call.timeline} /></div>
                </details> : null}
              </CardContent>
            </Card>)}
            {!requestedCallId && pagination.total_pages > 1 ? <div className="flex items-center justify-between gap-3 pt-2">
              <Button variant="outline" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || loading}>
                <ChevronLeft className="size-4" />{t('previousPage')}
              </Button>
              <p className="text-sm text-muted-foreground">
                {t('pageStatus', { page: pagination.page, pages: pagination.total_pages, total: pagination.total })}
              </p>
              <Button variant="outline" onClick={() => setPage((value) => Math.min(pagination.total_pages, value + 1))} disabled={page >= pagination.total_pages || loading}>
                {t('nextPage')}<ChevronRight className="size-4" />
              </Button>
            </div> : null}
          </div>}
  </div>
}

export default function CallTranscriptionsPage() {
  return <Suspense fallback={<div className="flex justify-center py-12 text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>}>
    <CallTranscriptionsContent />
  </Suspense>
}
