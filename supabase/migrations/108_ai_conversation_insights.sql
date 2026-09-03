-- ============================================================
-- 108 · Structured conversation insights
--
-- The analysis worker already produced a summary, sentiment, QA scores and
-- Nexo Memory facts. What it did not produce is the structured, queryable
-- classification the inbox and routing need: what the customer wants, how
-- urgent it is, how hot the lead is and which department should own it.
--
-- `insights` keeps the complete extraction (free to grow without another
-- migration); the columns beside it are the few fields that are filtered,
-- grouped or routed on, so they stay indexable.
-- ============================================================

ALTER TABLE ai_conversation_analyses
  ADD COLUMN IF NOT EXISTS insights jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS intent text,
  ADD COLUMN IF NOT EXISTS urgency text,
  ADD COLUMN IF NOT EXISTS lead_temperature text,
  ADD COLUMN IF NOT EXISTS handoff_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recommended_department text,
  ADD COLUMN IF NOT EXISTS recommended_queue_id uuid REFERENCES public.conversation_queues(id) ON DELETE SET NULL;

COMMENT ON COLUMN ai_conversation_analyses.insights IS
  'Full structured extraction: intent, sub_intent, need, product_service, impact, problem_summary, expected_result, missing_information, commercial_opportunity, customer_context_update, handoff_reason, …';

ALTER TABLE ai_conversation_analyses
  DROP CONSTRAINT IF EXISTS ai_conversation_analyses_urgency_check;
ALTER TABLE ai_conversation_analyses
  ADD CONSTRAINT ai_conversation_analyses_urgency_check
    CHECK (urgency IS NULL OR urgency IN ('low', 'medium', 'high', 'critical'));

ALTER TABLE ai_conversation_analyses
  DROP CONSTRAINT IF EXISTS ai_conversation_analyses_lead_temperature_check;
ALTER TABLE ai_conversation_analyses
  ADD CONSTRAINT ai_conversation_analyses_lead_temperature_check
    CHECK (lead_temperature IS NULL OR lead_temperature IN ('cold', 'warm', 'hot'));

CREATE INDEX IF NOT EXISTS ai_conversation_analyses_intent_idx
  ON ai_conversation_analyses(account_id, intent);
CREATE INDEX IF NOT EXISTS ai_conversation_analyses_lead_temperature_idx
  ON ai_conversation_analyses(account_id, lead_temperature);
CREATE INDEX IF NOT EXISTS ai_conversation_analyses_handoff_idx
  ON ai_conversation_analyses(account_id, handoff_required)
  WHERE handoff_required;

-- Opt-in: when the analysis says a human is needed and names a department,
-- move the conversation to that queue and let the queue's own rules pick the
-- agent. Off by default so no account starts re-routing silently.
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS analysis_auto_route_enabled boolean NOT NULL DEFAULT false;
