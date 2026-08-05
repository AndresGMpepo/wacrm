-- Conversation intelligence foundation. This is deliberately additive: it
-- does not alter existing messages, calls, or the working Yeastar softphone.

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS conversation_analysis_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS ai_conversation_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'whatsapp' CHECK (source IN ('whatsapp', 'call')),
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  summary text,
  sentiment text CHECK (sentiment IN ('positive', 'neutral', 'negative', 'mixed')),
  sentiment_score integer CHECK (sentiment_score BETWEEN 0 AND 100),
  next_best_action text,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  model text,
  analyzed_message_count integer NOT NULL DEFAULT 0,
  analyzed_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, source)
);

CREATE INDEX IF NOT EXISTS idx_ai_conversation_analyses_account_updated
  ON ai_conversation_analyses(account_id, updated_at DESC);

ALTER TABLE ai_conversation_analyses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_conversation_analyses_select ON ai_conversation_analyses;
CREATE POLICY ai_conversation_analyses_select ON ai_conversation_analyses FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_conversation_analyses_insert ON ai_conversation_analyses;
CREATE POLICY ai_conversation_analyses_insert ON ai_conversation_analyses FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS ai_conversation_analyses_update ON ai_conversation_analyses;
CREATE POLICY ai_conversation_analyses_update ON ai_conversation_analyses FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS ai_conversation_analyses_updated_at ON ai_conversation_analyses;
CREATE TRIGGER ai_conversation_analyses_updated_at
  BEFORE UPDATE ON ai_conversation_analyses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Keep AI usage accounting complete for summaries/sentiment without changing
-- any existing rows.
ALTER TABLE ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft', 'analysis'));
