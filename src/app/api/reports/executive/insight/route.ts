import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadAiConfig } from '@/lib/ai/config'
import { generateText } from '@/lib/ai/generate'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { AiError } from '@/lib/ai/types'
import { logAiUsage } from '@/lib/ai/usage'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { buildExecutiveReport, computeRange } from '@/lib/reports/build-executive-report'
import type { ExecutiveReport } from '@/lib/reports/executive-report-export'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

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
  if (!match) throw new AiError('La IA no devolvió un dictamen válido. Revisa que el modelo configurado tenga capacidad de respuesta suficiente.', { code: 'invalid_report_insight' })
  let data: Record<string, unknown>
  try {
    data = JSON.parse(match[0]) as Record<string, unknown>
  } catch {
    throw new AiError('La IA devolvió un dictamen incompleto. Intenta de nuevo o usa un periodo más corto.', { code: 'invalid_report_insight' })
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
  if (!priorities.length) throw new AiError('La IA no devolvió prioridades utilizables.', { code: 'invalid_report_insight' })
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

const MAX_INSIGHT_RANGE_DAYS = 60

// The dictamen is a long structured analysis, not a chat reply: reasoning
// models burn the 1024-token reply budget before emitting any JSON.
const INSIGHT_MAX_OUTPUT_TOKENS = 6_000
const INSIGHT_TIMEOUT_MS = 120_000

function parseInsightRange(from: unknown, to: unknown) {
  if (typeof from !== 'string' || typeof to !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw new AiError('El periodo del dictamen no es válido.', { code: 'invalid_report_range', status: 400 })
  }
  const dayCount = Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000) + 1
  if (dayCount < 1 || dayCount > MAX_INSIGHT_RANGE_DAYS) {
    throw new AiError(`El dictamen admite periodos de hasta ${MAX_INSIGHT_RANGE_DAYS} días.`, { code: 'invalid_report_range', status: 400 })
  }
  return { from, to }
}

/** The dictamen has its own (shorter) date range than the main dashboard —
 *  computes a fresh report for exactly that range instead of trusting
 *  whatever the client last had loaded. Calls the same in-process builder
 *  the executive report route uses, rather than an HTTP self-fetch (which
 *  can fail depending on how the app is proxied/deployed). */
async function fetchReportForRange(accountId: string, range: { from: string; to: string }): Promise<ExecutiveReport> {
  return buildExecutiveReport(accountId, computeRange(range.from, range.to)) as unknown as Promise<ExecutiveReport>
}

/** Keeps the model's input bounded: longer ranges add campaign rows that
 *  blow past the context budget without adding executive signal. */
function compactReportForModel(report: ExecutiveReport) {
  return {
    ...report,
    campaigns: {
      ...report.campaigns,
      items: report.campaigns.items.slice(0, 8).map((campaign) => ({
        name: campaign.name,
        status: campaign.status,
        total_recipients: campaign.total_recipients,
        delivery_rate: campaign.delivery_rate,
        read_rate: campaign.read_rate,
        reply_rate: campaign.reply_rate,
        attributed_deals: campaign.attributed_deals,
        attributed_won_value: campaign.attributed_won_value,
      })),
    },
  }
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

    const body = await request.json().catch(() => null) as { from?: unknown; to?: unknown } | null
    const range = parseInsightRange(body?.from, body?.to)
    const report = await fetchReportForRange(accountId, range)
    const config = await loadAiConfig(supabase, accountId)
    if (!config) return NextResponse.json({ error: 'Configura y activa la IA de la cuenta antes de generar el dictamen.' }, { status: 400 })

    const systemPrompt = [
      'Eres el comité ejecutivo de NexoOmni: especialista en dirección, marketing, ventas, operación, calidad de agentes y experiencia de cliente.',
      'Analiza únicamente los indicadores entregados. No inventes conversiones, causalidad, costos, ventas ni datos de clientes.',
      'Responde exclusivamente JSON válido, sin markdown, con exactamente esta forma:',
      '{"headline":"...","summary":"...","priorities":[{"area":"operacion|comercial|marketing|experiencia","priority":"alta|media|baja","title":"...","recommendation":"...","rationale":"..."}],"risks":["..."],"opportunities":["..."],"indicators_to_watch":["..."],"data_note":"... o null"}',
      'Propón entre 2 y 5 prioridades concretas, ordenadas por impacto. Distingue insuficiencia de datos de un mal resultado. Escribe en español claro para dirección.',
      'Incluye explícitamente en tu análisis (cuando haya datos suficientes): riesgos y oportunidades comerciales/operativos, tendencias frente al periodo anterior (new_conversations vs previous_new_conversations), calidad de agentes (average_qa_score general y por agente en "agents"), y si el objeto "appointments" trae datos, sus tasas de confirmación, cancelación, no-show, ocupación y conversión de conversación a cita.',
      `Perfil operativo de la empresa: ${report.meta.operating_mode}.`,
      config.systemPrompt ? `Contexto adicional de la empresa: ${config.systemPrompt}` : '',
    ].filter(Boolean).join('\n\n')
    const result = await generateText({
      config,
      systemPrompt,
      messages: [{ role: 'user', content: JSON.stringify(compactReportForModel(report)) }],
      maxOutputTokens: INSIGHT_MAX_OUTPUT_TOKENS,
      timeoutMs: INSIGHT_TIMEOUT_MS,
    })
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
