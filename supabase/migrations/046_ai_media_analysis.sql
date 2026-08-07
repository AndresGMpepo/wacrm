-- Optional, asynchronous AI processing for inbound WhatsApp images and
-- voice notes.  This never runs in the webhook request: a worker claims the
-- durable jobs after the message has already been saved and shown to agents.

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS analysis_images_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS analysis_voice_notes_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS media_analysis_daily_limit integer NOT NULL DEFAULT 100
    CHECK (media_analysis_daily_limit BETWEEN 1 AND 10000);

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS media_analysis_status text
    CHECK (media_analysis_status IN ('queued', 'processing', 'completed', 'skipped', 'failed')),
  ADD COLUMN IF NOT EXISTS media_transcript text,
  ADD COLUMN IF NOT EXISTS media_description text,
  ADD COLUMN IF NOT EXISTS media_analyzed_at timestamptz,
  ADD COLUMN IF NOT EXISTS media_analysis_error text;

CREATE TABLE IF NOT EXISTS ai_media_analysis_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('image', 'voice_note')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'skipped_limit', 'skipped_unsupported', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, message_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_ai_media_analysis_jobs_ready
  ON ai_media_analysis_jobs(status, created_at);

ALTER TABLE ai_media_analysis_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_media_analysis_jobs_admin_select ON ai_media_analysis_jobs;
CREATE POLICY ai_media_analysis_jobs_admin_select ON ai_media_analysis_jobs FOR SELECT
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS ai_media_analysis_jobs_updated_at ON ai_media_analysis_jobs;
CREATE TRIGGER ai_media_analysis_jobs_updated_at BEFORE UPDATE ON ai_media_analysis_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION public.queue_ai_media_analysis_from_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_account_id uuid;
  v_images_enabled boolean;
  v_voice_enabled boolean;
  v_kind text;
BEGIN
  -- Only customer media fetched from Meta's authenticated proxy is eligible.
  -- This excludes agent uploads and arbitrary public URLs from the first
  -- version, avoiding SSRF and unexpected processing costs.
  IF NEW.sender_type <> 'customer'
     OR NEW.media_url IS NULL
     OR NEW.media_url !~ '^/api/whatsapp/media/[^/?#]+$' THEN
    RETURN NEW;
  END IF;

  SELECT account_id INTO v_account_id FROM conversations WHERE id = NEW.conversation_id;
  SELECT analysis_images_enabled, analysis_voice_notes_enabled
    INTO v_images_enabled, v_voice_enabled
    FROM ai_configs WHERE account_id = v_account_id;

  IF NEW.content_type = 'image' AND COALESCE(v_images_enabled, false) THEN
    v_kind := 'image';
  ELSIF NEW.content_type = 'audio' AND COALESCE(v_voice_enabled, false) THEN
    v_kind := 'voice_note';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO ai_media_analysis_jobs(account_id, conversation_id, message_id, kind)
  VALUES (v_account_id, NEW.conversation_id, NEW.id, v_kind)
  ON CONFLICT (account_id, message_id, kind) DO NOTHING;

  UPDATE messages SET media_analysis_status = 'queued', media_analysis_error = null
    WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS queue_ai_media_analysis_message ON messages;
CREATE TRIGGER queue_ai_media_analysis_message AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION queue_ai_media_analysis_from_message();
