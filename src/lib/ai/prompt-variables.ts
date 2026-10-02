import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Prompt variable substitution for the AI reply assistant.
//
// buildSystemPrompt (./defaults.ts) appends the account's own
// system_prompt verbatim — a literal "{{current_datetime}}" in that
// text used to reach the model unchanged (no substitution existed at
// all). This resolves the small, fixed set of variables NexoOmni
// supports and replaces them before the prompt is built, so an
// account author can write {{current_datetime}} / {{active_promotions}}
// and get a real value every time the assistant runs.
// ============================================================

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

/** Replaces every `{{known_variable}}` with its resolved value. An
 *  unrecognized `{{something}}` is left untouched rather than erased —
 *  safer than silently dropping a typo'd variable name. */
export function substitutePromptVariables(text: string, variables: Record<string, string>): string {
  return text.replace(VARIABLE_PATTERN, (match, name: string) => variables[name] ?? match)
}

/** One promotion row, already filtered to "active today" by the caller. */
interface ActivePromotion {
  name: string
  description: string
  ends_on: string
}

function formatActivePromotions(promotions: ActivePromotion[]): string {
  if (promotions.length === 0) {
    return 'No hay promociones vigentes actualmente.'
  }
  return promotions
    .map((p) => `- ${p.name}: ${p.description} (vigente hasta ${p.ends_on})`)
    .join('\n')
}

/**
 * Resolves every supported variable for one account/send. `timezone`
 * decides what "today" and "now" mean for both {{current_datetime}}
 * and the active-promotions date filter — see ai_configs.timezone
 * (migration 137).
 */
export async function resolvePromptVariables(
  db: SupabaseClient,
  accountId: string,
  timezone: string,
): Promise<Record<string, string>> {
  const now = new Date()
  const currentDatetime = new Intl.DateTimeFormat('es-MX', {
    timeZone: timezone,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(now)
  // en-CA gives YYYY-MM-DD directly — the same shape as the DATE
  // columns, so the comparison below is a plain string/date compare.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now)

  // Defensive: a test double or an older DB missing migration 137 can
  // throw synchronously here (not just return a Supabase `error`) —
  // never let a promotions hiccup take down the whole reply.
  let promotions: ActivePromotion[] = []
  try {
    const { data, error } = await db
      .from('ai_promotions')
      .select('name, description, ends_on')
      .eq('account_id', accountId)
      .lte('starts_on', today)
      .gte('ends_on', today)
      .order('starts_on', { ascending: true })
    if (error) throw error
    promotions = (data as ActivePromotion[] | null) ?? []
  } catch (cause) {
    console.error('[ai prompt-variables] could not load active promotions:', cause)
  }

  return {
    current_datetime: currentDatetime,
    active_promotions: formatActivePromotions(promotions),
  }
}
