'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowUpRight, BarChart3, Bot, BriefcaseBusiness, CheckCircle2, Clock3, Download, Loader2, Megaphone, PhoneCall, RefreshCw, Siren, Sparkles, UsersRound } from 'lucide-react'

import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { executiveReportCsv, executiveReportExcelXml, executiveReportPrintHtml, reportExportFilename, type ExecutiveReport, type ExecutiveReportInsight } from '@/lib/reports/executive-report-export'
import { ReportScheduleManager } from '@/components/reports/report-schedule-manager'

type Report = ExecutiveReport
type ExecutiveInsight = ExecutiveReportInsight
type ActionQueue = {
  refreshed_at: string
  critical: Array<{ conversation_id: string; contact_name: string; sentiment_score: number | null; qa_score: number | null; next_best_action: string | null; analyzed_at: string }>
  overdue_follow_ups: Array<{ id: string; conversation_id: string; contact_name: string; due_at: string; created_at: string }>
  stalled_deals: Array<{ id: string; title: string; contact_name: string; value: number; currency: string; expected_close_date: string | null; updated_at: string; stage_name: string }>
}

const PERIODS = [7, 30, 90] as const
const nf = new Intl.NumberFormat('es-MX')
function dateOffset(days: number) { const date = new Date(); date.setDate(date.getDate() - days + 1); return date.toISOString().slice(0, 10) }
function today() { return new Date().toISOString().slice(0, 10) }
function minutes(value: number | null) { if (value === null) return 'Sin datos'; return value < 60 ? `${value} min` : `${Math.floor(value / 60)} h ${value % 60} min` }
function ratio(value: number | null) { return value === null ? '—' : `${value}%` }
function money(value: number, currency: string) { return new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value) }

function MetricCard({ icon: Icon, label, value, detail, tone = 'primary' }: { icon: typeof BarChart3; label: string; value: string; detail: string; tone?: 'primary' | 'emerald' | 'amber' | 'red' }) {
  const toneClass = { primary: 'text-primary bg-primary/10', emerald: 'text-emerald-400 bg-emerald-500/10', amber: 'text-amber-400 bg-amber-500/10', red: 'text-red-400 bg-red-500/10' }[tone]
  return <Card size="sm"><CardContent className="pt-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div><span className={`rounded-lg p-2 ${toneClass}`}><Icon className="size-4" /></span></div></CardContent></Card>
}

export default function ReportsPage() {
  const [days, setDays] = useState<number>(30)
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [insight, setInsight] = useState<ExecutiveInsight | null>(null)
  const [insightGeneratedAt, setInsightGeneratedAt] = useState<string | null>(null)
  const [insightLoading, setInsightLoading] = useState(false)
  const [insightError, setInsightError] = useState<string | null>(null)
  const [actionQueue, setActionQueue] = useState<ActionQueue | null>(null)
  const [actionQueueError, setActionQueueError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const response = await fetch(`/api/reports/executive?from=${dateOffset(days)}&to=${today()}`, { cache: 'no-store' })
      const payload = await response.json().catch(() => null) as Report & { error?: string }
      if (!response.ok) throw new Error(payload?.error ?? 'No se pudieron cargar los reportes.')
      setReport(payload)
      const insightResponse = await fetch(`/api/reports/executive/insight?from=${payload.meta.range.from}&to=${payload.meta.range.to}`, { cache: 'no-store' })
      const insightPayload = await insightResponse.json().catch(() => null) as { insight?: ExecutiveInsight | null; generated_at?: string | null }
      if (!insightResponse.ok) throw new Error('No se pudo recuperar el último dictamen guardado.')
      setInsight(insightPayload?.insight ?? null)
      setInsightGeneratedAt(insightPayload?.generated_at ?? null)
      setInsightError(null)
      try {
        const actionResponse = await fetch('/api/reports/action-queue', { cache: 'no-store' })
        const actionPayload = await actionResponse.json().catch(() => null) as ActionQueue & { error?: string }
        if (!actionResponse.ok) throw new Error(actionPayload?.error ?? 'No se pudo cargar la cola de acciones.')
        setActionQueue(actionPayload)
        setActionQueueError(null)
      } catch (actionError) {
        setActionQueueError(actionError instanceof Error ? actionError.message : 'No se pudo cargar la cola de acciones.')
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudieron cargar los reportes.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [days]) // eslint-disable-line react-hooks/exhaustive-deps

  const generateInsight = async () => {
    if (!report) return
    setInsightLoading(true)
    setInsightError(null)
    try {
      const response = await fetch('/api/reports/executive/insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report }),
      })
      const payload = await response.json().catch(() => null) as { insight?: ExecutiveInsight; generated_at?: string | null; error?: string }
      if (!response.ok || !payload?.insight) throw new Error(payload?.error ?? 'No se pudo generar el dictamen de IA.')
      setInsight(payload.insight)
      setInsightGeneratedAt(payload.generated_at ?? new Date().toISOString())
    } catch (err) {
      setInsightError(err instanceof Error ? err.message : 'No se pudo generar el dictamen de IA.')
    } finally {
      setInsightLoading(false)
    }
  }

  const download = (format: 'csv' | 'xls') => {
    if (!report) return
    const csv = format === 'csv'
    const blob = new Blob([csv ? executiveReportCsv(report, insight) : executiveReportExcelXml(report, insight)], {
      type: csv ? 'text/csv;charset=utf-8' : 'application/vnd.ms-excel;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = reportExportFilename(report, format)
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  const printPdf = () => {
    if (!report) return
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      setError('El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para descargar el PDF.')
      return
    }
    printWindow.document.write(executiveReportPrintHtml(report, insight))
    printWindow.document.close()
    window.setTimeout(() => {
      printWindow.focus()
      printWindow.print()
    }, 150)
  }

  const executiveReading = useMemo(() => {
    if (!report) return null
    if (report.intelligence.negative_rate !== null && report.intelligence.negative_rate >= 25) return { icon: AlertTriangle, title: 'Atención prioritaria: experiencia del cliente', text: `${report.intelligence.negative_rate}% de los análisis del periodo son negativos. Revisa los casos críticos y la carga de los agentes antes de aumentar campañas.`, tone: 'red' as const }
    if (report.operational.open_backlog > Math.max(5, report.operational.resolved)) return { icon: Clock3, title: 'La cola requiere seguimiento', text: `Hay ${report.operational.open_backlog} conversaciones abiertas o pendientes. Prioriza su asignación y respuesta antes de incrementar el volumen de entrada.`, tone: 'amber' as const }
    if (report.meta.operating_mode === 'commercial' && report.commercial.open_deals > 0) return { icon: BriefcaseBusiness, title: 'Foco comercial del periodo', text: `El pipeline mantiene ${report.commercial.open_deals} oportunidades abiertas por ${money(report.commercial.open_pipeline_value, report.meta.currency)}. Revisa las oportunidades sin actividad antes de su fecha esperada.`, tone: 'primary' as const }
    return { icon: CheckCircle2, title: 'Operación estable en el periodo', text: `Se registraron ${report.operational.new_conversations} conversaciones nuevas y ${report.operational.resolved} cierres. Mantén el seguimiento de los casos abiertos y la calidad de respuesta.`, tone: 'emerald' as const }
  }, [report])

  if (loading && !report) return <div className="flex min-h-64 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 size-5 animate-spin" /> Cargando reportes…</div>
  if (error && !report) return <Card className="max-w-xl"><CardHeader><CardTitle>No fue posible cargar Reportes</CardTitle><CardDescription>{error}</CardDescription></CardHeader><CardContent><Button onClick={() => void load()}><RefreshCw className="size-4" /> Reintentar</Button></CardContent></Card>
  if (!report || !executiveReading) return null
  const InsightIcon = executiveReading.icon
  const maxChannel = Math.max(1, ...report.channels.map((item) => item.conversations))

  const insightBorder = executiveReading.tone === 'red' ? 'border-red-500/40' : executiveReading.tone === 'amber' ? 'border-amber-500/40' : 'border-primary/30'
  return <div className="space-y-6">
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><h1 className="text-2xl font-bold tracking-tight text-foreground">Reportes ejecutivos</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Lectura directiva de operación, experiencia, campañas y pipeline. Las métricas se mantienen separadas por empresa.</p></div><div className="flex flex-wrap items-center gap-2"><div className="flex rounded-lg border border-border bg-card p-1">{PERIODS.map((period) => <button key={period} type="button" onClick={() => setDays(period)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${days === period ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{period} días</button>)}</div><Button variant="outline" size="sm" onClick={() => download('csv')}><Download className="size-4" /> CSV</Button><Button variant="outline" size="sm" onClick={() => download('xls')}><Download className="size-4" /> Excel</Button><Button variant="outline" size="sm" onClick={printPdf}><Download className="size-4" /> PDF</Button><Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar</Button></div></div>

    <Card className={insightBorder}><CardContent className="flex gap-3 pt-4"><div className={executiveReading.tone === 'red' ? 'text-red-400' : executiveReading.tone === 'amber' ? 'text-amber-400' : 'text-primary'}><InsightIcon className="mt-0.5 size-5" /></div><div><p className="font-semibold text-foreground">{executiveReading.title}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{executiveReading.text}</p><p className="mt-2 text-xs text-muted-foreground">Periodo: {report.meta.range.from} al {report.meta.range.to} · Perfil: {report.meta.operating_mode === 'commercial' ? 'Comercial' : report.meta.operating_mode === 'support' ? 'Soporte' : 'Híbrido'}</p></div></CardContent></Card>

    <section className="grid gap-4 xl:grid-cols-3">
      <Card className="border-red-500/30"><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Siren className="size-4 text-red-400" /> Casos críticos</CardTitle><CardDescription>Conversaciones abiertas cuyo último análisis disponible es negativo.</CardDescription></CardHeader><CardContent className="space-y-2">{actionQueue?.critical.length ? actionQueue.critical.map((item) => <div key={item.conversation_id} className="rounded-lg border border-border px-3 py-2.5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-foreground">{item.contact_name}</p><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.next_best_action || 'Revisar la conversación y definir el siguiente paso.'}</p><p className="mt-1 text-xs text-red-300">Sentimiento {item.sentiment_score ?? '—'}/100 · QA {item.qa_score ?? '—'}/100</p></div><Link className={buttonVariants({ variant: 'outline', size: 'sm', className: 'shrink-0' })} href={`/inbox?c=${item.conversation_id}`}>Abrir <ArrowUpRight className="size-3.5" /></Link></div></div>) : <p className="text-sm text-muted-foreground">No hay casos críticos abiertos.</p>}</CardContent></Card>
      <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><PhoneCall className="size-4 text-amber-400" /> Seguimientos vencidos</CardTitle><CardDescription>Tareas por falta de respuesta que ya requieren atención humana.</CardDescription></CardHeader><CardContent className="space-y-2">{actionQueue?.overdue_follow_ups.length ? actionQueue.overdue_follow_ups.map((item) => <div key={item.id} className="rounded-lg border border-border px-3 py-2.5"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-foreground">{item.contact_name}</p><p className="mt-1 text-xs text-muted-foreground">Pendiente desde {new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.due_at))}</p></div><Link className={buttonVariants({ variant: 'outline', size: 'sm', className: 'shrink-0' })} href={`/inbox?c=${item.conversation_id}`}>Atender <ArrowUpRight className="size-3.5" /></Link></div></div>) : <p className="text-sm text-muted-foreground">No hay seguimientos vencidos.</p>}</CardContent></Card>
      <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><BriefcaseBusiness className="size-4 text-primary" /> Oportunidades sin actividad</CardTitle><CardDescription>Tratos abiertos sin movimiento durante al menos siete días.</CardDescription></CardHeader><CardContent className="space-y-2">{actionQueue?.stalled_deals.length ? actionQueue.stalled_deals.map((item) => <div key={item.id} className="rounded-lg border border-border px-3 py-2.5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-foreground">{item.title}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.contact_name} · {item.stage_name || 'Sin etapa'}</p><p className="mt-1 text-xs text-muted-foreground">{money(item.value, item.currency)} · última actividad {new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date(item.updated_at))}</p></div><Link className={buttonVariants({ variant: 'outline', size: 'sm', className: 'shrink-0' })} href="/pipelines">Ver <ArrowUpRight className="size-3.5" /></Link></div></div>) : <p className="text-sm text-muted-foreground">No hay oportunidades sin actividad.</p>}</CardContent></Card>
    </section>
    {actionQueueError ? <p className="text-sm text-amber-300">La cola de acciones no pudo actualizarse: {actionQueueError}</p> : null}

    <Card className="border-primary/25">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /> Dictamen IA para dirección</CardTitle>
          <CardDescription className="mt-1">Lectura bajo demanda de los indicadores visibles. No ejecuta cambios ni envía mensajes; usa la IA configurada por esta empresa.</CardDescription>
        </div>
        <Button size="sm" onClick={() => void generateInsight()} disabled={insightLoading}>
          <Sparkles className={`size-4 ${insightLoading ? 'animate-pulse' : ''}`} />
          {insightLoading ? 'Analizando…' : insight ? 'Actualizar dictamen' : 'Generar dictamen IA'}
        </Button>
      </CardHeader>
      {insightGeneratedAt ? <p className="px-6 text-xs text-muted-foreground">Último dictamen guardado: {new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(insightGeneratedAt))}. Se conserva al salir o recargar esta página.</p> : null}
      {insight ? <CardContent className="space-y-5">
        <div><p className="font-semibold text-foreground">{insight.headline}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{insight.summary}</p></div>
        <div className="grid gap-3 lg:grid-cols-2">
          {insight.priorities.map((item, index) => <div key={`${item.area}-${item.title}-${index}`} className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2"><p className="font-medium text-foreground">{item.title}</p><Badge variant={item.priority === 'alta' ? 'destructive' : item.priority === 'media' ? 'secondary' : 'outline'}>{item.priority}</Badge></div>
            <p className="mt-2 text-sm text-foreground">{item.recommendation}</p>
            {item.rationale ? <p className="mt-2 text-xs leading-5 text-muted-foreground">Base: {item.rationale}</p> : null}
            <p className="mt-2 text-xs font-medium capitalize text-primary">{item.area}</p>
          </div>)}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div><p className="text-sm font-medium text-foreground">Riesgos</p><ul className="mt-2 space-y-1 text-sm text-muted-foreground">{insight.risks.length ? insight.risks.map((item) => <li key={item}>• {item}</li>) : <li>Sin riesgos concluyentes con los datos actuales.</li>}</ul></div>
          <div><p className="text-sm font-medium text-foreground">Oportunidades</p><ul className="mt-2 space-y-1 text-sm text-muted-foreground">{insight.opportunities.length ? insight.opportunities.map((item) => <li key={item}>• {item}</li>) : <li>Sin oportunidades concluyentes con los datos actuales.</li>}</ul></div>
          <div><p className="text-sm font-medium text-foreground">Indicadores a vigilar</p><ul className="mt-2 space-y-1 text-sm text-muted-foreground">{insight.indicators_to_watch.length ? insight.indicators_to_watch.map((item) => <li key={item}>• {item}</li>) : <li>Revisa el volumen, la primera respuesta y los casos negativos.</li>}</ul></div>
        </div>
        {insight.data_note ? <p className="rounded-md border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-200">Nota de datos: {insight.data_note}</p> : null}
      </CardContent> : null}
      {insightError ? <CardContent className="pt-0 text-sm text-red-400">{insightError}</CardContent> : null}
    </Card>

    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard icon={UsersRound} label="Conversaciones nuevas" value={nf.format(report.operational.new_conversations)} detail={`${report.operational.new_conversations - report.operational.previous_new_conversations >= 0 ? '+' : ''}${report.operational.new_conversations - report.operational.previous_new_conversations} vs. periodo anterior`} />
      <MetricCard icon={Clock3} label="Primera respuesta" value={minutes(report.operational.first_response_minutes)} detail={`${report.operational.first_response_samples} conversaciones con respuesta medible`} tone="amber" />
      <MetricCard icon={BriefcaseBusiness} label="Pipeline abierto" value={money(report.commercial.open_pipeline_value, report.meta.currency)} detail={`${report.commercial.open_deals} oportunidades abiertas`} tone="emerald" />
      <MetricCard icon={Bot} label="Experiencia IA" value={report.intelligence.average_sentiment_score === null ? 'Sin datos' : `${report.intelligence.average_sentiment_score}/100`} detail={`${report.intelligence.negative} análisis negativos · QA ${report.intelligence.average_qa_score ?? '—'}/100`} tone={report.intelligence.negative > 0 ? 'red' : 'primary'} />
    </section>

    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]"><Card><CardHeader><CardTitle>Rendimiento por canal</CardTitle><CardDescription>Volumen de conversaciones nuevas y respuesta inicial de cada canal.</CardDescription></CardHeader><CardContent className="space-y-4">{report.channels.length === 0 ? <p className="text-sm text-muted-foreground">Aún no hay conversaciones en este periodo.</p> : report.channels.map((channel) => <div key={channel.channel}><div className="flex items-center justify-between gap-3 text-sm"><span className="font-medium text-foreground">{channel.channel}</span><span className="text-muted-foreground">{channel.conversations} conversaciones · {minutes(channel.first_response_minutes)}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((channel.conversations / maxChannel) * 100)}%` }} /></div><p className="mt-1 text-xs text-muted-foreground">{channel.resolved} cierres actualizados en el periodo</p></div>)}</CardContent></Card>
      <Card><CardHeader><CardTitle>Salud operativa</CardTitle><CardDescription>Prioridad para dirección y responsables de operación.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Cola abierta</span><span className="font-semibold text-foreground">{report.operational.open_backlog}</span></div><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Conversaciones cerradas</span><span className="font-semibold text-foreground">{report.operational.resolved}</span></div><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Análisis negativos</span><span className="font-semibold text-red-400">{report.intelligence.negative} ({ratio(report.intelligence.negative_rate)})</span></div><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Tratos ganados</span><span className="font-semibold text-emerald-400">{report.commercial.won_deals} · {money(report.commercial.won_value, report.meta.currency)}</span></div><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Ganado atribuido a campañas</span><span className="font-semibold text-primary">{report.commercial.attributed_won_deals} · {money(report.commercial.attributed_won_value, report.meta.currency)}</span></div><p className="border-t border-border pt-3 text-xs text-muted-foreground">La atribución es manual: el equipo selecciona una campaña al crear o actualizar un trato. Los valores reflejan tratos actualizados en el periodo.</p></CardContent></Card></div>

    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Atribución comercial por canal</CardTitle>
          <CardDescription>Origen confirmado al crear o actualizar un trato; no se infiere por IA ni por una respuesta.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {report.commercial.source_channels.length === 0 ? <p className="text-sm text-muted-foreground">Aún no hay tratos actualizados en este periodo.</p> : report.commercial.source_channels.map((channel) => <div key={channel.channel} className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5"><div className="min-w-0"><p className="font-medium text-foreground">{channel.channel}</p><p className="mt-0.5 text-xs text-muted-foreground">{nf.format(channel.deals)} tratos · {nf.format(channel.open_deals)} abiertos · {nf.format(channel.lost_deals)} perdidos</p></div><div className="shrink-0 text-right"><p className="text-sm font-semibold text-emerald-400">{nf.format(channel.won_deals)} ganados</p><p className="mt-0.5 text-xs text-muted-foreground">{money(channel.won_value, report.meta.currency)}</p></div></div>)}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Salud del embudo</CardTitle>
          <CardDescription>Etapas de los tratos actualizados en el periodo; ayuda a localizar dónde se detiene el avance.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {report.funnel.length === 0 ? <p className="text-sm text-muted-foreground">Aún no hay tratos actualizados en este periodo.</p> : report.funnel.map((stage) => <div key={`${stage.position}-${stage.stage}`} className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5"><div className="min-w-0"><p className="font-medium text-foreground">{stage.stage}</p><p className="mt-0.5 text-xs text-muted-foreground">{nf.format(stage.deals)} tratos · {nf.format(stage.open_deals)} abiertos · {nf.format(stage.lost_deals)} perdidos</p></div><div className="shrink-0 text-right"><p className="text-sm font-semibold text-emerald-400">{nf.format(stage.won_deals)} ganados</p><p className="mt-0.5 text-xs text-muted-foreground">{money(stage.value, report.meta.currency)}</p></div></div>)}
        </CardContent>
      </Card>
    </div>

    <div className="grid gap-6 xl:grid-cols-2"><Card><CardHeader><CardTitle>Carga y respuesta por agente</CardTitle><CardDescription>Ayuda a redistribuir atención antes de que una cola se convierta en incidencia.</CardDescription></CardHeader><CardContent className="space-y-2">{report.agents.map((agent) => <div key={agent.id} className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5"><div className="min-w-0"><p className="truncate text-sm font-medium text-foreground">{agent.name}</p><p className="text-xs text-muted-foreground">{agent.open_conversations} chats abiertos</p></div><span className="shrink-0 text-sm text-muted-foreground">{minutes(agent.first_response_minutes)}</span></div>)}</CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Megaphone className="size-4 text-primary" /> Campañas del periodo</CardTitle><CardDescription>Entrega, lectura, respuesta y resultados de los tratos atribuidos manualmente.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid grid-cols-4 gap-2 text-center"><div className="rounded-lg bg-muted p-2"><p className="text-lg font-semibold">{ratio(report.campaigns.delivery_rate)}</p><p className="text-[11px] text-muted-foreground">entrega</p></div><div className="rounded-lg bg-muted p-2"><p className="text-lg font-semibold">{ratio(report.campaigns.read_rate)}</p><p className="text-[11px] text-muted-foreground">lectura</p></div><div className="rounded-lg bg-muted p-2"><p className="text-lg font-semibold">{ratio(report.campaigns.reply_rate)}</p><p className="text-[11px] text-muted-foreground">respuesta</p></div><div className="rounded-lg bg-primary/10 p-2"><p className="text-lg font-semibold text-primary">{report.commercial.attributed_deals}</p><p className="text-[11px] text-muted-foreground">tratos atribuidos</p></div></div>{report.campaigns.items.length === 0 ? <p className="text-sm text-muted-foreground">No se crearon ni atribuyeron campañas en este periodo.</p> : report.campaigns.items.slice(0, 4).map((campaign) => <div key={campaign.id} className="flex items-center justify-between gap-3 text-sm"><div className="min-w-0"><Link href={`/broadcasts/${campaign.id}`} className="block truncate font-medium text-foreground hover:text-primary hover:underline">{campaign.name}</Link><p className="truncate text-xs text-muted-foreground">{campaign.template_name}</p></div><span className="shrink-0 text-muted-foreground">{campaign.attributed_won_deals} ganados · {ratio(campaign.reply_rate)} respuesta</span></div>)}</CardContent></Card></div>

    <Card>
      <CardHeader>
        <CardTitle>Scorecard de campañas</CardTitle>
        <CardDescription>Compara campañas por resultados observables. Los tratos y valores se muestran sólo cuando el equipo registró una atribución manual.</CardDescription>
      </CardHeader>
      <CardContent>
        {report.campaigns.items.length === 0 ? <p className="text-sm text-muted-foreground">No se crearon ni atribuyeron campañas en este periodo.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[920px] text-sm"><thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-2 py-2 font-medium">Campaña</th><th className="px-2 py-2 font-medium">Audiencia</th><th className="px-2 py-2 font-medium">Entrega</th><th className="px-2 py-2 font-medium">Lectura</th><th className="px-2 py-2 font-medium">Respuesta</th><th className="px-2 py-2 font-medium">Tratos</th><th className="px-2 py-2 font-medium">Ganados</th><th className="px-2 py-2 font-medium">Valor ganado</th><th className="px-2 py-2 font-medium">Estado</th></tr></thead><tbody>{report.campaigns.items.map((campaign) => <tr key={campaign.id} className="border-b border-border/70 last:border-0"><td className="px-2 py-3"><Link href={`/broadcasts/${campaign.id}`} className="font-medium text-foreground hover:text-primary hover:underline">{campaign.name}</Link><p className="mt-0.5 max-w-64 truncate text-xs text-muted-foreground">{campaign.template_name}</p></td><td className="px-2 py-3 text-muted-foreground">{nf.format(campaign.total_recipients ?? 0)}</td><td className="px-2 py-3 text-muted-foreground">{ratio(campaign.delivery_rate)}</td><td className="px-2 py-3 text-muted-foreground">{ratio(campaign.read_rate)}</td><td className="px-2 py-3 font-medium text-foreground">{ratio(campaign.reply_rate)}</td><td className="px-2 py-3 text-muted-foreground">{nf.format(campaign.attributed_deals)}</td><td className="px-2 py-3 font-medium text-emerald-400">{nf.format(campaign.attributed_won_deals)}</td><td className="px-2 py-3 font-medium text-emerald-400">{money(campaign.attributed_won_value, report.meta.currency)}</td><td className="px-2 py-3 capitalize text-muted-foreground">{campaign.status}</td></tr>)}</tbody></table></div>}
      </CardContent>
    </Card>

    {report.meta.response_metrics_capped ? <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">La métrica de primera respuesta se calculó sobre las primeras 5,000 conversaciones del periodo para proteger el rendimiento. La siguiente fase incorporará agregados en base de datos para volúmenes mayores.</p> : null}
    <ReportScheduleManager />
    {error ? <p className="text-sm text-red-400">{error}</p> : null}
    <p className="flex items-center gap-2 text-xs text-muted-foreground"><Download className="size-3.5" /> CSV, Excel y PDF usan exactamente el periodo visible. En PDF, el navegador abrirá la opción para guardar como PDF.</p>
  </div>
}
