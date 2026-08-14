-- Manual executive report insights use the same account-level BYO AI key as
-- conversation analysis. Keep their consumption visible as a distinct mode.

ALTER TABLE ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft', 'analysis', 'report'));
