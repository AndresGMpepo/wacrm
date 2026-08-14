'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, RotateCcw, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type Job = { id: string; conversation_id: string; trigger: string; status: string; scheduled_at: string; attempts: number; error_message: string | null; updated_at: string }
type Data = { policy: { conversation_analysis_enabled: boolean; analysis_daily_limit: number; analysis_monthly_limit: number } | null; usage: { daily: number; monthly: number }; counts: Record<string, number>; jobs: Job[] }

const label: Record<string, string> = { customer_message: 'Mensaje del cliente', transfer: 'Transferencia', close: 'Cierre', manual: 'Manual', queued: 'Pendiente', processing: 'Procesando', completed: 'Completado', skipped_limit: 'Omitido por política', failed: 'Fallido' }

export function AiAnalysisJobsCard() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState<string | null>(null)
  const load = useCallback(async () => {
    setLoading(true)
    try { const response = await fetch('/api/ai/analysis-jobs', { cache: 'no-store' }); const json = await response.json(); if (!response.ok) throw new Error(json.error); setData(json) } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo cargar la cola de IA.') } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  const retry = async (id: string) => {
    setRetrying(id)
    try { const response = await fetch('/api/ai/analysis-jobs', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: id }) }); const json = await response.json(); if (!response.ok) throw new Error(json.error); toast.success(json.already_queued ? 'El trabajo ya está en proceso.' : 'Trabajo enviado nuevamente a la cola.'); await load() } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo reintentar.') } finally { setRetrying(null) }
  }
  return <section className="rounded-xl border bg-card p-5">
    <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold">Supervisión de análisis automático</h2><p className="mt-1 text-sm text-muted-foreground">Estado del worker, límites y últimos trabajos de la cuenta.</p></div><Button size="icon" variant="ghost" onClick={() => void load()} disabled={loading} title="Actualizar"><RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} /></Button></div>
    {data ? <><div className="mt-4 grid gap-3 sm:grid-cols-4"><Metric label="Pendientes" value={data.counts.queued ?? 0} icon={Clock3} /><Metric label="Completados" value={data.counts.completed ?? 0} icon={CheckCircle2} /><Metric label="Fallidos" value={data.counts.failed ?? 0} icon={XCircle} /><Metric label="Omitidos por política" value={data.counts.skipped_limit ?? 0} icon={AlertTriangle} /></div>
      <p className="mt-4 text-sm text-muted-foreground">Consumo: <b className="text-foreground">{data.usage.daily}/{data.policy?.analysis_daily_limit ?? 0}</b> análisis hoy · <b className="text-foreground">{data.usage.monthly}/{data.policy?.analysis_monthly_limit ?? 0}</b> este mes.</p>
      <p className="mt-1 text-xs text-muted-foreground">Los omitidos no son fallos técnicos: pueden deberse al límite diario, mensual o al máximo configurado para una misma conversación. El reintento sólo está disponible para errores técnicos.</p>
      {!data.policy?.conversation_analysis_enabled ? <p className="mt-2 text-sm text-amber-500">El análisis automático está desactivado en Configuración de IA.</p> : null}
      <div className="mt-4 divide-y rounded-md border">{data.jobs.length ? data.jobs.map((job) => <div key={job.id} className="flex items-center gap-3 p-3 text-sm"><span className="min-w-0 flex-1"><b>{label[job.status] ?? job.status}</b><span className="block text-xs text-muted-foreground">{label[job.trigger] ?? job.trigger} · {new Date(job.updated_at).toLocaleString()} {job.error_message ? `· ${job.error_message}` : ''}</span></span>{job.status === 'failed' ? <Button size="sm" variant="outline" disabled={retrying === job.id} onClick={() => void retry(job.id)}><RotateCcw className="size-3.5" />Reintentar</Button> : null}</div>) : <p className="p-4 text-sm text-muted-foreground">Aún no hay trabajos en la cola.</p>}</div>
    </> : <p className="mt-4 text-sm text-muted-foreground">{loading ? 'Cargando…' : 'No se pudo cargar la información.'}</p>}
  </section>
}

function Metric({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Clock3 }) { return <div className="rounded-md border p-3"><p className="flex items-center gap-1 text-xs text-muted-foreground"><Icon className="size-3" />{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div> }
