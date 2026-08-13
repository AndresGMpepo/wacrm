'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BarChart3, Bot, BriefcaseBusiness, CheckCircle2, Clock3, Download, Loader2, Megaphone, RefreshCw, UsersRound } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type Report = {
  meta: { operating_mode: 'commercial' | 'support' | 'hybrid'; currency: string; range: { from: string; to: string; days: number }; response_metrics_capped: boolean }
  operational: { new_conversations: number; previous_new_conversations: number; open_backlog: number; resolved: number; first_response_minutes: number | null; first_response_samples: number }
  channels: { channel: string; conversations: number; resolved: number; first_response_minutes: number | null }[]
  agents: { id: string; name: string; open_conversations: number; first_response_minutes: number | null; measured_responses: number }[]
  intelligence: { analyzed: number; negative: number; negative_rate: number | null; average_sentiment_score: number | null; average_qa_score: number | null }
  commercial: { open_pipeline_value: number; open_deals: number; won_deals: number; lost_deals: number; won_value: number }
  campaigns: { totals: { recipients: number; sent: number; delivered: number; read: number; replied: number; failed: number }; delivery_rate: number | null; read_rate: number | null; reply_rate: number | null; items: { id: string; name: string; status: string; created_at: string; total_recipients: number | null; delivered_count: number | null; read_count: number | null; replied_count: number | null; failed_count: number | null }[] }
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

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const response = await fetch(`/api/reports/executive?from=${dateOffset(days)}&to=${today()}`, { cache: 'no-store' })
      const payload = await response.json().catch(() => null) as Report & { error?: string }
      if (!response.ok) throw new Error(payload?.error ?? 'No se pudieron cargar los reportes.')
      setReport(payload)
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudieron cargar los reportes.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [days]) // eslint-disable-line react-hooks/exhaustive-deps

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
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><h1 className="text-2xl font-bold tracking-tight text-foreground">Reportes ejecutivos</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Lectura directiva de operación, experiencia, campañas y pipeline. Las métricas se mantienen separadas por empresa.</p></div><div className="flex flex-wrap items-center gap-2"><div className="flex rounded-lg border border-border bg-card p-1">{PERIODS.map((period) => <button key={period} type="button" onClick={() => setDays(period)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${days === period ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{period} días</button>)}</div><Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar</Button></div></div>

    <Card className={insightBorder}><CardContent className="flex gap-3 pt-4"><div className={executiveReading.tone === 'red' ? 'text-red-400' : executiveReading.tone === 'amber' ? 'text-amber-400' : 'text-primary'}><InsightIcon className="mt-0.5 size-5" /></div><div><p className="font-semibold text-foreground">{executiveReading.title}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{executiveReading.text}</p><p className="mt-2 text-xs text-muted-foreground">Periodo: {report.meta.range.from} al {report.meta.range.to} · Perfil: {report.meta.operating_mode === 'commercial' ? 'Comercial' : report.meta.operating_mode === 'support' ? 'Soporte' : 'Híbrido'}</p></div></CardContent></Card>

    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard icon={UsersRound} label="Conversaciones nuevas" value={nf.format(report.operational.new_conversations)} detail={`${report.operational.new_conversations - report.operational.previous_new_conversations >= 0 ? '+' : ''}${report.operational.new_conversations - report.operational.previous_new_conversations} vs. periodo anterior`} />
      <MetricCard icon={Clock3} label="Primera respuesta" value={minutes(report.operational.first_response_minutes)} detail={`${report.operational.first_response_samples} conversaciones con respuesta medible`} tone="amber" />
      <MetricCard icon={BriefcaseBusiness} label="Pipeline abierto" value={money(report.commercial.open_pipeline_value, report.meta.currency)} detail={`${report.commercial.open_deals} oportunidades abiertas`} tone="emerald" />
      <MetricCard icon={Bot} label="Experiencia IA" value={report.intelligence.average_sentiment_score === null ? 'Sin datos' : `${report.intelligence.average_sentiment_score}/100`} detail={`${report.intelligence.negative} análisis negativos · QA ${report.intelligence.average_qa_score ?? '—'}/100`} tone={report.intelligence.negative > 0 ? 'red' : 'primary'} />
    </section>

    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]"><Card><CardHeader><CardTitle>Rendimiento por canal</CardTitle><CardDescription>Volumen de conversaciones nuevas y respuesta inicial de cada canal.</CardDescription></CardHeader><CardContent className="space-y-4">{report.channels.length === 0 ? <p className="text-sm text-muted-foreground">Aún no hay conversaciones en este periodo.</p> : report.channels.map((channel) => <div key={channel.channel}><div className="flex items-center justify-between gap-3 text-sm"><span className="font-medium text-foreground">{channel.channel}</span><span className="text-muted-foreground">{channel.conversations} conversaciones · {minutes(channel.first_response_minutes)}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((channel.conversations / maxChannel) * 100)}%` }} /></div><p className="mt-1 text-xs text-muted-foreground">{channel.resolved} cierres actualizados en el periodo</p></div>)}</CardContent></Card>
      <Card><CardHeader><CardTitle>Salud operativa</CardTitle><CardDescription>Prioridad para dirección y responsables de operación.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Cola abierta</span><span className="font-semibold text-foreground">{report.operational.open_backlog}</span></div><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Conversaciones cerradas</span><span className="font-semibold text-foreground">{report.operational.resolved}</span></div><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Análisis negativos</span><span className="font-semibold text-red-400">{report.intelligence.negative} ({ratio(report.intelligence.negative_rate)})</span></div><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Tratos ganados*</span><span className="font-semibold text-emerald-400">{report.commercial.won_deals} · {money(report.commercial.won_value, report.meta.currency)}</span></div><p className="border-t border-border pt-3 text-xs text-muted-foreground">*Basado en la última actualización del trato dentro del periodo. La atribución completa de ventas por canal se incorporará en la siguiente fase.</p></CardContent></Card></div>

    <div className="grid gap-6 xl:grid-cols-2"><Card><CardHeader><CardTitle>Carga y respuesta por agente</CardTitle><CardDescription>Ayuda a redistribuir atención antes de que una cola se convierta en incidencia.</CardDescription></CardHeader><CardContent className="space-y-2">{report.agents.map((agent) => <div key={agent.id} className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5"><div className="min-w-0"><p className="truncate text-sm font-medium text-foreground">{agent.name}</p><p className="text-xs text-muted-foreground">{agent.open_conversations} chats abiertos</p></div><span className="shrink-0 text-sm text-muted-foreground">{minutes(agent.first_response_minutes)}</span></div>)}</CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Megaphone className="size-4 text-primary" /> Campañas del periodo</CardTitle><CardDescription>Entrega, lectura y respuesta de los envíos masivos. No atribuye ventas todavía.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-muted p-2"><p className="text-lg font-semibold">{ratio(report.campaigns.delivery_rate)}</p><p className="text-[11px] text-muted-foreground">entrega</p></div><div className="rounded-lg bg-muted p-2"><p className="text-lg font-semibold">{ratio(report.campaigns.read_rate)}</p><p className="text-[11px] text-muted-foreground">lectura</p></div><div className="rounded-lg bg-muted p-2"><p className="text-lg font-semibold">{ratio(report.campaigns.reply_rate)}</p><p className="text-[11px] text-muted-foreground">respuesta</p></div></div>{report.campaigns.items.length === 0 ? <p className="text-sm text-muted-foreground">No se crearon campañas en este periodo.</p> : report.campaigns.items.slice(0, 4).map((campaign) => <div key={campaign.id} className="flex items-center justify-between gap-3 text-sm"><span className="truncate font-medium text-foreground">{campaign.name}</span><span className="shrink-0 text-muted-foreground">{campaign.replied_count ?? 0} respuestas</span></div>)}</CardContent></Card></div>

    {report.meta.response_metrics_capped ? <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">La métrica de primera respuesta se calculó sobre las primeras 5,000 conversaciones del periodo para proteger el rendimiento. La siguiente fase incorporará agregados en base de datos para volúmenes mayores.</p> : null}
    {error ? <p className="text-sm text-red-400">{error}</p> : null}
    <p className="flex items-center gap-2 text-xs text-muted-foreground"><Download className="size-3.5" /> Exportación CSV/Excel, PDF ejecutivo y envíos programados se habilitarán sobre este tablero, sin cambiar la definición de las métricas.</p>
  </div>
}
