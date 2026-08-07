-- A one-minute window is intentionally supported for controlled testing.
-- The unique partial index on pending tasks still prevents repeated tasks
-- for the same account and conversation.
ALTER TABLE call_follow_up_policies
  DROP CONSTRAINT IF EXISTS call_follow_up_policies_no_reply_minutes_check;

ALTER TABLE call_follow_up_policies
  ADD CONSTRAINT call_follow_up_policies_no_reply_minutes_check
  CHECK (no_reply_minutes BETWEEN 1 AND 10080);

-- Surface a new follow-up task through the existing notification transport.
-- A task without an assigned agent remains visible in the operational queue,
-- but cannot be sent to an arbitrary agent as a personal notification.
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'incoming_message', 'negative_sentiment', 'call_follow_up'));

CREATE OR REPLACE FUNCTION public.notify_call_follow_up_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_name text;
BEGIN
  IF NEW.assigned_agent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(c.name, ''), c.phone, 'un contacto')
    INTO v_contact_name
  FROM conversations cv
  LEFT JOIN contacts c ON c.id = cv.contact_id
  WHERE cv.id = NEW.conversation_id;

  INSERT INTO notifications (
    account_id, user_id, type, conversation_id, contact_id, title, body
  )
  SELECT
    NEW.account_id,
    NEW.assigned_agent_id,
    'call_follow_up',
    NEW.conversation_id,
    cv.contact_id,
    'Llamada de seguimiento pendiente',
    'El cliente ' || COALESCE(v_contact_name, 'sin nombre')
      || ' no respondió. Revisa el chat y decide si deseas llamarlo.'
  FROM conversations cv
  WHERE cv.id = NEW.conversation_id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never prevent a follow-up task because its optional notification failed.
  RAISE WARNING 'Failed to notify follow-up task %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.notify_call_follow_up_task() OWNER TO postgres;

DROP TRIGGER IF EXISTS notify_call_follow_up_task ON call_follow_up_tasks;
CREATE TRIGGER notify_call_follow_up_task
  AFTER INSERT ON call_follow_up_tasks
  FOR EACH ROW EXECUTE FUNCTION public.notify_call_follow_up_task();
