-- Correlate Yeastar's per-leg CDR rows without collapsing or losing the
-- transcript/analysis that belongs to each individual leg.
ALTER TABLE public.yeastar_call_transcriptions
  ADD COLUMN IF NOT EXISTS session_call_id TEXT,
  ADD COLUMN IF NOT EXISTS agent_name TEXT;

UPDATE public.yeastar_call_transcriptions
SET session_call_id = COALESCE(
  NULLIF(yeastar_payload #>> '{event,uid}', ''),
  NULLIF(yeastar_payload #>> '{event,call_id}', ''),
  call_id
)
WHERE session_call_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_yeastar_call_transcriptions_account_session
  ON public.yeastar_call_transcriptions(account_id, session_call_id);

CREATE INDEX IF NOT EXISTS idx_yeastar_call_transcriptions_account_started
  ON public.yeastar_call_transcriptions(account_id, started_at DESC NULLS LAST, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_yeastar_call_transcriptions_account_phone
  ON public.yeastar_call_transcriptions(account_id, customer_phone);

CREATE INDEX IF NOT EXISTS idx_yeastar_call_transcriptions_account_extension
  ON public.yeastar_call_transcriptions(account_id, agent_extension);

COMMENT ON COLUMN public.yeastar_call_transcriptions.session_call_id IS
  'Root Yeastar call/UID shared by all CDR legs in the same call. call_id remains the unique per-row key.';
COMMENT ON COLUMN public.yeastar_call_transcriptions.agent_name IS
  'PBX-provided extension/agent display name when available; profile data remains authoritative for mapped NexoOmni users.';
