-- Restore the notification transport used by every inbound channel.
-- This is intentionally idempotent: applying it on an already healthy
-- tenant only replaces the trigger function with the current definition.

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'incoming_message', 'negative_sentiment', 'call_follow_up'));

CREATE OR REPLACE FUNCTION public.notify_incoming_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_contact_id uuid;
  v_contact_name text;
  v_body text;
BEGIN
  IF NEW.sender_type <> 'customer' THEN
    RETURN NEW;
  END IF;

  SELECT c.account_id, c.contact_id
    INTO v_account_id, v_contact_id
  FROM public.conversations c
  WHERE c.id = NEW.conversation_id;

  IF v_account_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), phone, 'un contacto')
    INTO v_contact_name
  FROM public.contacts
  WHERE id = v_contact_id;

  v_body := COALESCE(NULLIF(NEW.content_text, ''), '[Mensaje ' || NEW.content_type || ']');

  INSERT INTO public.notifications (
    account_id, user_id, type, conversation_id, contact_id, title, body
  )
  SELECT
    v_account_id,
    p.user_id,
    'incoming_message',
    NEW.conversation_id,
    v_contact_id,
    'Nuevo mensaje de ' || COALESCE(v_contact_name, 'un contacto'),
    LEFT(v_body, 240)
  FROM public.profiles p
  WHERE p.account_id = v_account_id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create incoming-message notifications for message %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.notify_incoming_message() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_customer_message_received ON public.messages;
CREATE TRIGGER on_customer_message_received
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_incoming_message();

ALTER TABLE public.notifications REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END;
$$;
