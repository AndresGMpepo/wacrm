-- Supervisor alerts for completed conversation analyses with negative sentiment.
-- This is deliberately database-side so it applies equally to manual and worker runs.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_last_sentiment text
    CHECK (ai_last_sentiment IN ('positive', 'neutral', 'negative', 'mixed')),
  ADD COLUMN IF NOT EXISTS ai_last_sentiment_score integer
    CHECK (ai_last_sentiment_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS ai_last_analyzed_at timestamptz;

ALTER TABLE ai_conversation_analyses
  ADD COLUMN IF NOT EXISTS negative_alerted_at timestamptz;

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'incoming_message', 'negative_sentiment'));

CREATE OR REPLACE FUNCTION public.sync_conversation_analysis_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_name text;
BEGIN
  IF NEW.status <> 'completed' OR NEW.sentiment IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE conversations
  SET
    ai_last_sentiment = NEW.sentiment,
    ai_last_sentiment_score = NEW.sentiment_score,
    ai_last_analyzed_at = COALESCE(NEW.analyzed_at, now())
  WHERE id = NEW.conversation_id
    AND account_id = NEW.account_id;

  -- Only notify once while this analysis remains negative. A later neutral
  -- result clears the marker, allowing a meaningful new negative escalation.
  IF NEW.sentiment <> 'negative' THEN
    UPDATE ai_conversation_analyses
    SET negative_alerted_at = NULL
    WHERE id = NEW.id AND negative_alerted_at IS NOT NULL;
    RETURN NEW;
  END IF;

  IF NEW.negative_alerted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(c.name, ''), c.phone, 'un contacto')
    INTO v_contact_name
  FROM conversations cv
  JOIN contacts c ON c.id = cv.contact_id
  WHERE cv.id = NEW.conversation_id;

  INSERT INTO notifications (
    account_id, user_id, type, conversation_id, contact_id, title, body
  )
  SELECT
    NEW.account_id,
    p.user_id,
    'negative_sentiment',
    NEW.conversation_id,
    cv.contact_id,
    'Atencion: sentimiento negativo',
    'La conversacion con ' || COALESCE(v_contact_name, 'un contacto')
      || ' requiere seguimiento.'
  FROM profiles p
  JOIN conversations cv ON cv.id = NEW.conversation_id
  WHERE p.account_id = NEW.account_id
    AND p.account_role IN ('owner', 'admin');

  UPDATE ai_conversation_analyses
  SET negative_alerted_at = now()
  WHERE id = NEW.id AND negative_alerted_at IS NULL;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to sync analysis status for conversation %: %', NEW.conversation_id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.sync_conversation_analysis_status() OWNER TO postgres;

DROP TRIGGER IF EXISTS sync_conversation_analysis_status ON ai_conversation_analyses;
CREATE TRIGGER sync_conversation_analysis_status
  AFTER INSERT OR UPDATE OF status, sentiment, sentiment_score, analyzed_at
  ON ai_conversation_analyses
  FOR EACH ROW EXECUTE FUNCTION public.sync_conversation_analysis_status();

-- Show the latest already-completed result in the inbox immediately after
-- this migration, without creating retroactive supervisor alerts.
UPDATE conversations cv
SET
  ai_last_sentiment = latest.sentiment,
  ai_last_sentiment_score = latest.sentiment_score,
  ai_last_analyzed_at = COALESCE(latest.analyzed_at, latest.updated_at)
FROM (
  SELECT DISTINCT ON (conversation_id)
    conversation_id, sentiment, sentiment_score, analyzed_at, updated_at
  FROM ai_conversation_analyses
  WHERE status = 'completed' AND sentiment IS NOT NULL
  ORDER BY conversation_id, updated_at DESC
) latest
WHERE cv.id = latest.conversation_id;
