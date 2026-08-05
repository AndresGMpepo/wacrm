-- Administrator-owned automatic analysis policies and durable queue.
-- Jobs are persisted; a separate worker can process them without ever
-- delaying a WhatsApp webhook or a browser action.

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS analysis_on_customer_message boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS analysis_on_transfer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS analysis_on_close boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS analysis_daily_limit integer NOT NULL DEFAULT 100
    CHECK (analysis_daily_limit BETWEEN 1 AND 10000),
  ADD COLUMN IF NOT EXISTS analysis_monthly_limit integer NOT NULL DEFAULT 1000
    CHECK (analysis_monthly_limit BETWEEN 1 AND 100000),
  ADD COLUMN IF NOT EXISTS analysis_max_per_conversation integer NOT NULL DEFAULT 6
    CHECK (analysis_max_per_conversation BETWEEN 1 AND 100);

CREATE TABLE IF NOT EXISTS ai_analysis_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  trigger text NOT NULL CHECK (trigger IN ('customer_message', 'transfer', 'close', 'manual')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'skipped_limit', 'failed')),
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id, conversation_id, trigger)
);

CREATE INDEX IF NOT EXISTS idx_ai_analysis_jobs_ready
  ON ai_analysis_jobs(status, scheduled_at);
ALTER TABLE ai_analysis_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_analysis_jobs_admin_select ON ai_analysis_jobs;
CREATE POLICY ai_analysis_jobs_admin_select ON ai_analysis_jobs FOR SELECT
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS ai_analysis_jobs_updated_at ON ai_analysis_jobs;
CREATE TRIGGER ai_analysis_jobs_updated_at BEFORE UPDATE ON ai_analysis_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION public.queue_ai_analysis_job(
  p_account_id uuid, p_conversation_id uuid, p_trigger text, p_delay interval DEFAULT interval '0 minutes'
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO ai_analysis_jobs(account_id, conversation_id, trigger, status, scheduled_at, attempts, error_message)
  VALUES (p_account_id, p_conversation_id, p_trigger, 'queued', now() + p_delay, 0, null)
  ON CONFLICT (account_id, conversation_id, trigger) DO UPDATE
    SET status = 'queued', scheduled_at = EXCLUDED.scheduled_at, attempts = 0, error_message = null;
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_ai_analysis_from_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_account_id uuid; v_enabled boolean;
BEGIN
  IF NEW.sender_type <> 'customer' THEN RETURN NEW; END IF;
  SELECT account_id INTO v_account_id FROM conversations WHERE id = NEW.conversation_id;
  SELECT conversation_analysis_enabled AND analysis_on_customer_message INTO v_enabled FROM ai_configs WHERE account_id = v_account_id;
  IF COALESCE(v_enabled, false) THEN
    PERFORM queue_ai_analysis_job(v_account_id, NEW.conversation_id, 'customer_message', interval '2 minutes');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_ai_analysis_from_conversation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_enabled boolean;
BEGIN
  IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT conversation_analysis_enabled AND analysis_on_close INTO v_enabled FROM ai_configs WHERE account_id = NEW.account_id;
    IF COALESCE(v_enabled, false) THEN PERFORM queue_ai_analysis_job(NEW.account_id, NEW.id, 'close'); END IF;
  END IF;
  IF NEW.assigned_agent_id IS NOT NULL AND OLD.assigned_agent_id IS DISTINCT FROM NEW.assigned_agent_id THEN
    SELECT conversation_analysis_enabled AND analysis_on_transfer INTO v_enabled FROM ai_configs WHERE account_id = NEW.account_id;
    IF COALESCE(v_enabled, false) THEN PERFORM queue_ai_analysis_job(NEW.account_id, NEW.id, 'transfer'); END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS queue_ai_analysis_message ON messages;
CREATE TRIGGER queue_ai_analysis_message AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION queue_ai_analysis_from_message();
DROP TRIGGER IF EXISTS queue_ai_analysis_conversation ON conversations;
CREATE TRIGGER queue_ai_analysis_conversation AFTER UPDATE OF status, assigned_agent_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION queue_ai_analysis_from_conversation();
