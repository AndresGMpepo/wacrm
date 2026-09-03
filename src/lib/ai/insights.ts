/**
 * Structured conversation insights.
 *
 * The analysis worker asks the model for one JSON document per conversation.
 * Beyond the summary/sentiment/QA block it already had, this module owns the
 * classification an operation actually routes and reports on: what the
 * customer wants, how urgent it is, how hot the lead is, which department
 * should own it, and what is new about the customer.
 *
 * Everything here is best-effort: a field the model can't ground in the
 * conversation must come back empty rather than invented, so every parser
 * below drops what it can't validate instead of guessing a default.
 */

export type Urgency = 'low' | 'medium' | 'high' | 'critical'
export type LeadTemperature = 'cold' | 'warm' | 'hot'

export interface ConversationInsights {
  /** Coarse classification, e.g. soporte_tecnico / cotizacion / reclamo. */
  intent: string | null
  sub_intent: string | null
  /** What the customer needs, in one sentence. */
  need: string | null
  customer_name: string | null
  company: string | null
  product_service: string | null
  urgency: Urgency | null
  /** Business impact of the customer's problem. */
  impact: string | null
  commercial_opportunity: boolean | null
  lead_temperature: LeadTemperature | null
  /** Department the model believes should own the conversation. */
  recommended_department: string | null
  problem_summary: string | null
  expected_result: string | null
  /** What is still missing to resolve the request. */
  missing_information: string[]
  handoff_required: boolean
  handoff_reason: string | null
  /** Only what was newly learned about the customer in this conversation —
   *  this is what feeds Nexo Memory instead of re-storing the transcript. */
  customer_context_update: string[]
}

/** JSON contract appended to the analysis system prompt. */
export const INSIGHTS_PROMPT =
  ' Devuelve también una clasificación estructurada en "insights": {' +
  '"intent":"...","sub_intent":"...","need":"...","customer_name":"...","company":"...",' +
  '"product_service":"...","urgency":"low|medium|high|critical","impact":"...",' +
  '"commercial_opportunity":true|false,"lead_temperature":"cold|warm|hot",' +
  '"recommended_department":"...","problem_summary":"...","expected_result":"...",' +
  '"missing_information":["..."],"handoff_required":true|false,"handoff_reason":"...",' +
  '"customer_context_update":["..."]}. ' +
  'En "customer_context_update" escribe únicamente lo NUEVO que aprendiste del cliente en esta conversación ' +
  '(datos, contexto, preferencias, restricciones), nunca un resumen de lo que ya se sabía ni saludos. ' +
  'Deja en null o en lista vacía cualquier campo sin evidencia clara en la conversación; no inventes nombres, empresas ni departamentos.'

/** Names the model may choose from for `recommended_department`. */
export function departmentsPrompt(queueNames: string[]): string {
  if (queueNames.length === 0) return ''
  return ` En "recommended_department" usa exactamente uno de estos departamentos: ${queueNames.join(' | ')}. Si ninguno corresponde, déjalo en null.`
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.toLowerCase() === 'null' || trimmed === '-') return null
  return trimmed.slice(0, max)
}

function stringList(value: unknown, max: number, itemMax: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => text(entry, itemMax))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, max)
}

function bool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

export function parseConversationInsights(raw: Record<string, unknown>): ConversationInsights {
  // Accept both a nested "insights" object and a flat document — models drift
  // between the two and the extraction is too valuable to drop over shape.
  const nested = raw.insights
  const value: Record<string, unknown> =
    nested && typeof nested === 'object' && !Array.isArray(nested)
      ? { ...raw, ...(nested as Record<string, unknown>) }
      : raw

  const urgency = text(value.urgency, 20)?.toLowerCase()
  const temperature = text(value.lead_temperature, 20)?.toLowerCase()

  return {
    intent: text(value.intent, 80),
    sub_intent: text(value.sub_intent, 80),
    need: text(value.need, 300),
    customer_name: text(value.customer_name, 160),
    company: text(value.company, 160),
    product_service: text(value.product_service, 160),
    urgency: (['low', 'medium', 'high', 'critical'] as const).find((u) => u === urgency) ?? null,
    impact: text(value.impact, 300),
    commercial_opportunity: bool(value.commercial_opportunity),
    lead_temperature: (['cold', 'warm', 'hot'] as const).find((l) => l === temperature) ?? null,
    recommended_department: text(value.recommended_department, 80),
    problem_summary: text(value.problem_summary, 1000),
    expected_result: text(value.expected_result, 500),
    missing_information: stringList(value.missing_information, 5, 200),
    handoff_required: bool(value.handoff_required) ?? false,
    handoff_reason: text(value.handoff_reason, 300),
    customer_context_update: stringList(value.customer_context_update, 5, 300),
  }
}

/** Match `recommended_department` against the account's queues, ignoring case
 *  and accents so "Cobranza" and "cobranzas " both land. */
export function matchDepartmentQueue(
  queues: { id: string; name: string }[],
  department: string | null,
): string | null {
  if (!department) return null
  const normalize = (value: string) =>
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .trim()
      .toLowerCase()
  const target = normalize(department)
  return (
    queues.find((q) => normalize(q.name) === target)?.id ??
    queues.find((q) => normalize(q.name).startsWith(target) || target.startsWith(normalize(q.name)))?.id ??
    null
  )
}
