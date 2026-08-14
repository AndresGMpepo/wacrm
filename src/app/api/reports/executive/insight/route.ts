import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadAiConfig } from '@/lib/ai/config'
import { generateText } from '@/lib/ai/generate'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { AiError } from '@/lib/ai/types'
import { logAiUsage } from '@/lib/ai/usage'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import type { ExecutiveReport } from '@/lib/reports/executive-report-export'

type InsightArea = 'operacion' | 'comercial' | 'marketing' | 'experiencia'
type InsightPriority = 'alta' | 'media' | 'baja'

type ExecutiveInsight = {
  headline: string
  summary: string
  priorities: Array<{
    area: InsightArea
    priority: InsightPriority
    title: string
    recommendation: string
    rationale: string
  }>
  risks: string[]
  opportunities: string[]
  indicators_to_watch: string[]
  data_note: string | null
}

function asString(value: unknown, limit: number) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

function strings(value: unknown, limit: number, itemLimit: number) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim().slice(0, itemLimit)).filter(Boolean).slice(0, limit)
    : []
}

function parseInsight(raw: string): ExecutiveInsight {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new AiError('La IA no devolviÃ³ un dictamen vÃ¡lido.', { code: 'invalid_report_insight' })
  let data: Record<string, unknown>
  try {
    data = JSON.parse(match[0]) as Record<string, unknown>
  } catch {
    throw new AiError('La IA no devolviÃ³ un dictamen vÃ¡lido.', { code: 'invalid_report_insight' })
  }
  const priorities = Array.isArray(data.priorities)
    ? data.priorities.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const candidate = item as Record<string, unknown>
      const area = candidate.area
      const priority = candidate.priority
      if (!['operacion', 'comercial', 'marketing', 'experiencia'].includes(String(area))) return []
      if (!['alta', 'media', 'baja'].includes(String(priority))) return []
      const title = asString(candidate.title, 160)
      const recommendation = asString(candidate.recommendation, 500)
      const rationale = asString(candidate.rationale, 500)
      return title && recommendation ? [{ area: area as InsightArea, priority: priority as InsightPriority, title, recommendation, rationale }] : []
    }).slice(0, 5)
    : []
  if (!priorities.length) throw new AiError('La IA no devolviÃ³ prioridades utilizables.', { code: 'invalid_report_insight' })
  return {
    headline: asString(data.headline, 180) || 'Lectura ejecutiva del periodo',
    summary: asString(data.summary, 1_000),
    priorities,
    risks: strings(data.risks, 4, 320),
    opportunities: strings(data.opportunities, 4, 320),
    indicators_to_watch: strings(data.indicators_to_watch, 5, 220),
    data_note: asString(data.data_note, 320) || null,
  }
}

function isReport(value: unknown): value is ExecutiveReport {
  if (!value || typeof value !== 'object') return false
  const report = value as Partial<ExecutiveReport>
  return Boolean(report.meta && report.operational && report.intelligence && report.commercial && Array.isArray(report.channels) && Array.isArray(report.agents) && report.campaigns)
}

function reportRange(report: ExecutiveReport) {
  const { from, to } = report.meta.range
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw new AiError('El periodo del reporte no es válido.', { code: 'invalid_report_range', status: 400 })
  }
  return { from, to }
}

export async function GET(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const url = new URL(request.url)
    const from = url.searchParams.get('from') ?? ''
    const to = url.searchParams.get('to') ?? ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      return NextResponse.json({ error: 'El periodo del reporte no es válido.' }, { status: 400 })
    }
    const { data, error } = await supabaseAdmin()
      .from('executive_report_insights')
      .select('insight, generated_at')
      .eq('account_id', accountId)
      .eq('range_from', from)
      .eq('range_to', to)
      .maybeSingle()
    if (error) throw error
    return NextResponse.json({ insight: data?.insight ?? null, generated_at: data?.generated_at ?? null })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-report:${accountId}`, RATE_LIMITS.aiReportAccount)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null) as { report?: unknown } | null
    if (!isReport(body?.report)) return NextResponse.json({ error: 'El reporte a analizar no es vÃ¡lido.' }, { status: 400 })
    const report = body.report
    const range = reportRange(report)
    const config = await loadAiConfig(supabase, accountId)
    if (!config) return NextResponse.json({ error: 'Configura y activa la IA de la cuenta antes de generar el dictamen.' }, { status: 400 })

    const systemPrompt = [
      'Eres el comitÃ© ejecutivo de NexoOmni: especialista en direcciÃ³n, marketing, ventas, operaciÃ³n y experiencia de cliente.',
      'Analiza Ãºnicamente los indicadores entregados. No inventes conversiones, causalidad, costos, ventas ni datos de clientes.',
      'Responde exclusivamente JSON vÃ¡lido, sin markdown, con exactamente esta forma:',
      '{"headline":"...","summary":"...","priorities":[{"area":"operacion|comercial|marketing|experiencia","priority":"alta|media|baja","title":"...","recommendation":"...","rationale":"..."}],"risks":["..."],"opportunities":["..."],"indicators_to_watch":["..."],"data_note":"... o null"}',
      'PropÃ³n entre 2 y 5 prioridades concretas, ordenadas por impacto. Distingue insuficiencia de datos de un mal resultado. Escribe en espaÃ±ol claro para direcciÃ³n.',
      `Perfil operativo de la empresa: ${report.meta.operating_mode}.`,
      config.systemPrompt ? `Contexto adicional de la empresa: ${config.systemPrompt}` : '',
    ].filter(Boolean).join('\n\n')
    const result = await generateText({ config, systemPrompt, messages: [{ role: 'user', content: JSON.stringify(report) }] })
    const insight = parseInsight(result.text)
    const admin = supabaseAdmin()
    const generatedAt = new Date().toISOString()
    const { error: saveError } = await admin
      .from('executive_report_insights')
      .upsert({ account_id: accountId, range_from: range.from, range_to: range.to, insight, generated_by: userId, generated_at: generatedAt }, { onConflict: 'account_id,range_from,range_to' })
    if (saveError) throw saveError
    void logAiUsage(admin, { accountId, conversationId: null, mode: 'report', provider: config.provider, model: config.model, usage: result.usage })
    return NextResponse.json({ insight, generated_at: generatedAt })
  } catch (error) {
    if (error instanceof AiError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    return toErrorResponse(error)
  }
}
