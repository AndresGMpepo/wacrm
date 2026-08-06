-- QA scoring is part of the existing analysis request, so enabling it does
-- not add a second provider call or consume a second analysis allowance.

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS qa_scoring_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS qa_scoring_criteria text;

ALTER TABLE ai_conversation_analyses
  ADD COLUMN IF NOT EXISTS qa_score integer CHECK (qa_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS qa_empathy_score integer CHECK (qa_empathy_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS qa_objection_handling_score integer CHECK (qa_objection_handling_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS qa_script_adherence_score integer CHECK (qa_script_adherence_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS qa_summary text,
  ADD COLUMN IF NOT EXISTS qa_findings jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_ai_conversation_analyses_account_qa
  ON ai_conversation_analyses(account_id, qa_score)
  WHERE qa_score IS NOT NULL;
