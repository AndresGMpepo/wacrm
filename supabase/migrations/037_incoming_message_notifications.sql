-- ============================================================
-- INCOMING MESSAGE NOTIFICATIONS
-- ============================================================
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'incoming_message'));

CREATE OR REPLACE FUNCTION notify_incoming_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_contact_id UUID;
  v_contact_name TEXT;
  v_body TEXT;
BEGIN
  IF NEW.sender_type <> 'customer' THEN
    RETURN NEW;
  END IF;

  SELECT c.account_id, c.contact_id
    INTO v_account_id, v_contact_id
  FROM conversations c
  WHERE c.id = NEW.conversation_id;

  IF v_account_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), phone, 'un contacto')
    INTO v_contact_name
  FROM contacts
  WHERE id = v_contact_id;

  v_body := COALESCE(NULLIF(NEW.content_text, ''), '[Mensaje ' || NEW.content_type || ']');

  INSERT INTO notifications (
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
  FROM profiles p
  WHERE p.account_id = v_account_id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create incoming-message notifications for message %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION notify_incoming_message() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_customer_message_received ON messages;
CREATE TRIGGER on_customer_message_received
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION notify_incoming_message();
