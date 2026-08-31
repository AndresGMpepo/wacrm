import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'

function dayStart() { const date = new Date(); date.setHours(0, 0, 0, 0); return date.toISOString() }
function monthStart() { const date = new Date(); date.setDate(1); date.setHours(0, 0, 0, 0); return date.toISOString() }

export async function GET() {
  try {
    const { accountId } = await requireRole('admin')
    // The role check above authorizes access; the server client makes the
    // operational dashboard resilient to stale/missing client RLS claims.
    const supabase = supabaseAdmin()
    const [jobsResult, policyResult, dailyResult, monthlyResult] = await Promise.all([
      supabase.from('ai_analysis_jobs').select('id, conversation_id, trigger, status, scheduled_at, attempts, error_message, updated_at').eq('account_id', accountId).order('updated_at', { ascending: false }).limit(20),
      supabase.from('ai_configs').select('conversation_analysis_enabled, analysis_daily_limit, analysis_monthly_limit').eq('account_id', accountId).maybeSingle(),
      supabase.from('ai_usage_log').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('mode', 'analysis').gte('created_at', dayStart()),
      supabase.from('ai_usage_log').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('mode', 'analysis').gte('created_at', monthStart()),
    ])
    if (jobsResult.error || policyResult.error || dailyResult.error || monthlyResult.error) throw jobsResult.error ?? policyResult.error ?? dailyResult.error ?? monthlyResult.error
    const jobs = jobsResult.data ?? []
    const counts = jobs.reduce<Record<string, number>>((all, job) => ({ ...all, [job.status]: (all[job.status] ?? 0) + 1 }), {})
    return NextResponse.json({
      policy: policyResult.data ?? null,
      usage: { daily: dailyResult.count ?? 0, monthly: monthlyResult.count ?? 0 },
      counts,
      jobs,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    const jobId = typeof body?.job_id === 'string' ? body.job_id : ''
    if (!jobId) return NextResponse.json({ error: 'job_id is required' }, { status: 400 })

    // The worker claims queued jobs independently. Read with the server client
    // after the role check so a stale browser view receives a useful status
    // instead of an ambiguous 404 caused by RLS or a worker race.
    const db = supabaseAdmin()
    const { data: job, error: readError } = await db
      .from('ai_analysis_jobs')
      .select('id, status, error_message')
      .eq('id', jobId).eq('account_id', accountId)
      .maybeSingle()
    if (readError) throw readError
    if (!job) return NextResponse.json({ error: 'No se encontró este trabajo de análisis.' }, { status: 404 })
    if (job.status === 'queued' || job.status === 'processing') return NextResponse.json({ success: true, already_queued: true })
    if (job.status === 'completed') return NextResponse.json({ error: 'Este trabajo ya fue procesado. Actualiza la lista para ver el resultado.' }, { status: 409 })
    if (job.status === 'skipped_limit') return NextResponse.json({ error: job.error_message ?? 'El trabajo fue omitido por la política de límites. Ajusta la política antes de volver a encolarlo.' }, { status: 409 })
    if (job.status !== 'failed') return NextResponse.json({ error: 'Este trabajo no está disponible para reintento.' }, { status: 409 })

    const { data, error } = await db
      .from('ai_analysis_jobs')
      .update({ status: 'queued', scheduled_at: new Date().toISOString(), error_message: null, attempts: 0 })
      .eq('id', jobId).eq('account_id', accountId).eq('status', 'failed')
      .select('id').maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'El worker ya tomó este trabajo. Actualiza la lista.' }, { status: 409 })
    return NextResponse.json({ success: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
