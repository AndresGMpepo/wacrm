-- Call transcriptions already compute sentiment via analyzeCall() (see
-- src/lib/telephony/call-summary.ts), but it was only forwarded to
-- contact_memory and discarded for the call record itself: there was no
-- per-call sentiment visible and no supervisor alert for a negative call,
-- unlike WhatsApp conversations (migration 041). This matters most for
-- calls that never touched a NexoOmni conversation at all — e.g. a branch
-- extension or a remote agent answering on the Yeastar Linkus softphone.
ALTER TABLE public.yeastar_call_transcriptions
  ADD COLUMN IF NOT EXISTS sentiment text
    CHECK (sentiment IN ('positive', 'neutral', 'negative', 'mixed')),
  ADD COLUMN IF NOT EXISTS sentiment_score integer
    CHECK (sentiment_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS sentiment_alerted_at timestamptz;

-- Lets a 'negative_sentiment' notification link straight back to the call
-- (there is no conversation_id for a PBX-only call).
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS call_id uuid REFERENCES public.yeastar_call_transcriptions(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.sync_call_sentiment_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_name text;
BEGIN
  IF NEW.sentiment IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only notify once while this call remains negative. A re-analyzed call
  -- that is no longer negative clears the marker, allowing a meaningful
  -- new negative escalation later.
  IF NEW.sentiment <> 'negative' THEN
    IF NEW.sentiment_alerted_at IS NOT NULL THEN
      UPDATE public.yeastar_call_transcriptions SET sentiment_alerted_at = NULL
      WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.sentiment_alerted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(c.name, ''), c.phone)
    INTO v_contact_name
  FROM public.contacts c
  WHERE c.id = NEW.contact_id;

  INSERT INTO public.notifications (
    account_id, user_id, type, contact_id, call_id, title, body
  )
  SELECT
    NEW.account_id,
    p.user_id,
    'negative_sentiment',
    NEW.contact_id,
    NEW.id,
    'Atencion: llamada con sentimiento negativo',
    'La llamada con '
      || COALESCE(v_contact_name, NULLIF(NEW.customer_name, ''), NEW.customer_phone, 'un cliente')
      || COALESCE(' (ext. ' || NEW.agent_extension || ')', '')
      || ' requiere seguimiento.'
  FROM public.profiles p
  WHERE p.account_id = NEW.account_id
    AND p.account_role IN ('owner', 'admin');

  UPDATE public.yeastar_call_transcriptions
  SET sentiment_alerted_at = now()
  WHERE id = NEW.id AND sentiment_alerted_at IS NULL;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to sync sentiment alert for call %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.sync_call_sentiment_alert() OWNER TO postgres;

DROP TRIGGER IF EXISTS sync_call_sentiment_alert ON public.yeastar_call_transcriptions;
CREATE TRIGGER sync_call_sentiment_alert
  AFTER INSERT OR UPDATE OF sentiment, sentiment_score
  ON public.yeastar_call_transcriptions
  FOR EACH ROW EXECUTE FUNCTION public.sync_call_sentiment_alert();
