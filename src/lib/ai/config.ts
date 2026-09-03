import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import type { AiConfig } from './types'

interface AiConfigRow {
  provider: 'openai' | 'anthropic'
  model: string
  analysis_model?: string | null
  image_analysis_model?: string | null
  voice_transcription_model?: string | null
  api_key: string
  system_prompt: string | null
  is_active: boolean
  auto_reply_enabled: boolean
  auto_reply_max_per_conversation: number
  handoff_agent_id: string | null
  handoff_target?: 'unassigned' | 'agent' | 'queue' | 'ai_queue' | null
  handoff_queue_id?: string | null
  channel_types?: string[] | null
  embeddings_api_key: string | null
}

const CONFIG_COLUMNS =
  'provider, model, analysis_model, image_analysis_model, voice_transcription_model, api_key, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, handoff_target, handoff_queue_id, channel_types, embeddings_api_key'

// Keep AI operational while a rolling deployment is waiting for migration 101.
// The dedicated model columns are additive, so the existing general model is a
// safe fallback until the database schema catches up.
const LEGACY_CONFIG_COLUMNS =
  'provider, model, api_key, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, embeddings_api_key'

function isMissingModelColumn(error: { code?: string; message?: string }) {
  return error.code === '42703' || /(?:analysis_model|image_analysis_model|voice_transcription_model|handoff_target|handoff_queue_id|channel_types)/i.test(error.message ?? '')
}

/**
 * Load and decrypt the account's AI config for *use* (draft or
 * auto-reply). Returns `null` when there's no row or the master switch
 * (`is_active`) is off — both mean "AI is not available", which callers
 * treat identically. Throws only if the stored key can't be decrypted
 * (mismatched `ENCRYPTION_KEY`), so that distinct failure surfaces
 * rather than looking like "not configured".
 *
 * Works with any client: pass the RLS-scoped SSR client from a
 * dashboard route, or the service-role admin client from the webhook.
 */
export async function loadAiConfig(
  db: SupabaseClient,
  accountId: string,
  opts: { requireActive?: boolean } = {},
): Promise<AiConfig | null> {
  const { requireActive = true } = opts
  const primary = await db
    .from('ai_configs')
    .select(CONFIG_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle()
  let data = primary.data as AiConfigRow | null
  let error = primary.error

  if (error && isMissingModelColumn(error)) {
    console.warn('[ai config] Migration 101 is pending; using the general AI model until it is applied.')
    const fallback = await db
      .from('ai_configs')
      .select(LEGACY_CONFIG_COLUMNS)
      .eq('account_id', accountId)
      .maybeSingle()
    data = fallback.data as AiConfigRow | null
    error = fallback.error
  }

  if (error) throw error
  if (!data) return null

  const row = data as AiConfigRow
  // The Playground passes requireActive:false so an admin can test the
  // agent before flipping the master switch on.
  if (requireActive && !row.is_active) return null
  // Defensive: the column is NOT NULL, but a partial write / manual DB
  // edit could leave it empty. Treat a missing key as "not configured"
  // rather than letting decrypt() throw on null.
  if (!row.api_key) return null

  // The embeddings key is optional and independent of the chat key —
  // a corrupt/undecryptable one should downgrade to lexical KB, not
  // take down draft/auto-reply, so decrypt failures are swallowed here.
  let embeddingsApiKey: string | null = null
  if (row.embeddings_api_key) {
    try {
      embeddingsApiKey = decrypt(row.embeddings_api_key)
    } catch {
      // Not silent — a rotated/mismatched ENCRYPTION_KEY here means
      // semantic search quietly stops working, so leave a breadcrumb.
      console.error(
        `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; semantic search is disabled until it is re-entered.`,
      )
      embeddingsApiKey = null
    }
  }

  return {
    provider: row.provider,
    model: row.model,
    // Existing rows keep working after the additive migration even before an
    // administrator saves the new routing fields.
    analysisModel: row.analysis_model?.trim() || row.model,
    imageAnalysisModel: row.image_analysis_model?.trim() || 'gpt-4.1-mini',
    voiceTranscriptionModel: row.voice_transcription_model?.trim() || 'gpt-4o-mini-transcribe',
    apiKey: decrypt(row.api_key),
    systemPrompt: row.system_prompt,
    isActive: row.is_active,
    autoReplyEnabled: row.auto_reply_enabled,
    autoReplyMaxPerConversation: row.auto_reply_max_per_conversation,
    handoffAgentId: row.handoff_agent_id,
    handoffTarget: row.handoff_target ?? 'agent',
    handoffQueueId: row.handoff_queue_id ?? null,
    channelTypes: Array.isArray(row.channel_types) && row.channel_types.length > 0 ? row.channel_types : null,
    embeddingsApiKey,
  }
}

/**
 * Load + decrypt just the embeddings key, independent of `is_active`.
 * Used by the knowledge-base ingest routes so the KB gets embedded (and
 * semantic search works) whenever an embeddings key is present, even if
 * the assistant's master switch is currently off.
 *
 * Returns `{ key, corrupt }`: `key` is null when there's no key OR it
 * can't be decrypted; `corrupt` distinguishes those cases so callers can
 * warn ("a key is set but unusable") rather than silently indexing
 * lexical-only and reporting success.
 */
export async function loadEmbeddingsKey(
  db: SupabaseClient,
  accountId: string,
): Promise<{ key: string | null; corrupt: boolean }> {
  const { data, error } = await db
    .from('ai_configs')
    .select('embeddings_api_key')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data?.embeddings_api_key) return { key: null, corrupt: false }
  try {
    return { key: decrypt(data.embeddings_api_key), corrupt: false }
  } catch {
    console.error(
      `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY.`,
    )
    return { key: null, corrupt: true }
  }
}
