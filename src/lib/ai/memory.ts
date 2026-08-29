import { supabaseAdmin } from '@/lib/ai/admin-client'

type Db = ReturnType<typeof supabaseAdmin>

export type MemoryExtraction = {
  customer_stage: string | null
  risk_level: 'low' | 'medium' | 'high' | null
  opportunity_score: number | null
  interests: Array<{ text: string; confidence: number }>
  objections: Array<{ text: string; confidence: number }>
  commitments: Array<{ description: string; owner: 'agent' | 'customer'; due_date: string | null }>
  important_facts: string[]
}

function clampConfidence(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.75
}

function parseFactList(value: unknown): Array<{ text: string; confidence: number }> {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (typeof entry === 'string') return { text: entry.trim().slice(0, 300), confidence: 0.75 }
      if (entry && typeof entry === 'object') {
        const text = String((entry as Record<string, unknown>).text ?? '').trim().slice(0, 300)
        return text ? { text, confidence: clampConfidence((entry as Record<string, unknown>).confidence) } : null
      }
      return null
    })
    .filter((entry): entry is { text: string; confidence: number } => Boolean(entry?.text))
    .slice(0, 8)
}

function parseDueDate(value: unknown) {
  if (typeof value !== 'string') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

/** Reads the Nexo Memory fields from the same JSON the analysis worker already
 *  asked the model for — no extra AI call. */
export function parseMemoryExtraction(value: Record<string, unknown>): MemoryExtraction {
  const opportunityScore = Math.round(Number(value.opportunity_score))
  const riskLevel = String(value.risk_level ?? '')
  return {
    customer_stage: typeof value.customer_stage === 'string' ? value.customer_stage.trim().slice(0, 80) || null : null,
    risk_level: (['low', 'medium', 'high'] as const).includes(riskLevel as 'low' | 'medium' | 'high') ? (riskLevel as 'low' | 'medium' | 'high') : null,
    opportunity_score: Number.isFinite(opportunityScore) ? Math.min(100, Math.max(0, opportunityScore)) : null,
    interests: parseFactList(value.interests),
    objections: parseFactList(value.objections),
    commitments: Array.isArray(value.commitments)
      ? value.commitments
          .map((entry) => {
            if (!entry || typeof entry !== 'object') return null
            const description = String((entry as Record<string, unknown>).description ?? '').trim().slice(0, 300)
            if (!description) return null
            const owner = (entry as Record<string, unknown>).owner === 'customer' ? 'customer' : 'agent'
            return { description, owner, due_date: parseDueDate((entry as Record<string, unknown>).due_date) } as const
          })
          .filter((entry): entry is { description: string; owner: 'agent' | 'customer'; due_date: string | null } => Boolean(entry))
          .slice(0, 6)
      : [],
    important_facts: Array.isArray(value.important_facts)
      ? value.important_facts.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim().slice(0, 500)).filter(Boolean).slice(0, 5)
      : [],
  }
}

/** Below this confidence an inferred fact (interest/objection) is discarded
 *  instead of being written as if it were established knowledge. */
const FACT_CONFIDENCE_FLOOR = 0.6

async function upsertFacts(
  db: Db,
  accountId: string,
  contactId: string,
  sourceConversationId: string,
  category: 'interest' | 'objection',
  facts: Array<{ text: string; confidence: number }>,
) {
  for (const fact of facts) {
    if (fact.confidence < FACT_CONFIDENCE_FLOOR) continue
    const { data: existing } = await db.from('contact_facts').select('id')
      .eq('contact_id', contactId).eq('category', category).eq('status', 'active')
      .ilike('fact', fact.text).maybeSingle()
    if (existing) continue
    await db.from('contact_facts').insert({
      account_id: accountId, contact_id: contactId, category, fact: fact.text, confidence: fact.confidence,
      source_type: 'conversation', source_id: sourceConversationId,
    })
  }
}

/** Applies one conversation's structured extraction on top of a contact's
 *  memory: overwrites the consolidated summary, appends timeline events,
 *  records new facts/commitments. Never deletes prior history. */
export async function applyContactMemory(
  db: Db,
  args: { accountId: string; contactId: string; conversationId: string },
  analysis: { summary: string; sentiment: string; sentiment_score: number; next_best_action: string },
  memory: MemoryExtraction,
) {
  const { accountId, contactId, conversationId } = args
  await db.from('contact_memory').upsert({
    contact_id: contactId,
    account_id: accountId,
    current_summary: analysis.summary || null,
    current_stage: memory.customer_stage,
    sentiment: analysis.sentiment,
    sentiment_score: analysis.sentiment_score,
    risk_level: memory.risk_level,
    opportunity_score: memory.opportunity_score,
    next_best_action: analysis.next_best_action || null,
    last_source_conversation_id: conversationId,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'contact_id' })

  for (const fact of memory.important_facts) {
    await db.from('contact_memory_events').insert({
      account_id: accountId, contact_id: contactId, event_type: 'fact', summary: fact,
      importance: memory.risk_level === 'high' ? 'high' : 'normal', confidence: 0.8,
      source_type: 'conversation', source_id: conversationId,
    })
  }

  await upsertFacts(db, accountId, contactId, conversationId, 'interest', memory.interests)
  await upsertFacts(db, accountId, contactId, conversationId, 'objection', memory.objections)

  for (const commitment of memory.commitments) {
    const { data: existing } = await db.from('contact_commitments').select('id')
      .eq('contact_id', contactId).eq('status', 'pending').ilike('description', commitment.description).maybeSingle()
    if (existing) continue
    await db.from('contact_commitments').insert({
      account_id: accountId, contact_id: contactId, description: commitment.description, owner: commitment.owner,
      due_date: commitment.due_date, source_type: 'conversation', source_id: conversationId,
    })
  }
}
