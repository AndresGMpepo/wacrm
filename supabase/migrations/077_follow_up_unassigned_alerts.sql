-- Follow-up alerts must not disappear when an inbound conversation has not
-- yet been assigned. In that case owners and admins receive the alert so one
-- of them can take ownership or assign the conversation deliberately.
CREATE OR REPLACE FUNCTION public.notify_call_follow_up_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_name text;
BEGIN
  SELECT COALESCE(NULLIF(c.name, ''), c.phone, 'un contacto')
    INTO v_contact_name
  FROM conversations cv
  LEFT JOIN contacts c ON c.id = cv.contact_id
  WHERE cv.id = NEW.conversation_id;

  IF NEW.assigned_agent_id IS NOT NULL THEN
    INSERT INTO notifications (
      account_id, user_id, type, conversation_id, contact_id, title, body
    )
    SELECT
      NEW.account_id,
      NEW.assigned_agent_id,
      'call_follow_up',
      NEW.conversation_id,
      cv.contact_id,
      'Seguimiento pendiente',
      'El cliente ' || COALESCE(v_contact_name, 'sin nombre')
        || ' no respondió. Revisa el chat y decide si deseas llamarlo.'
    FROM conversations cv
    WHERE cv.id = NEW.conversation_id;
  ELSE
    INSERT INTO notifications (
      account_id, user_id, type, conversation_id, contact_id, title, body
    )
    SELECT
      NEW.account_id,
      p.user_id,
      'call_follow_up',
      NEW.conversation_id,
      cv.contact_id,
      'Seguimiento sin asignar',
      'El cliente ' || COALESCE(v_contact_name, 'sin nombre')
        || ' no respondió. Asigna o atiende esta conversación.'
    FROM profiles p
    JOIN conversations cv ON cv.id = NEW.conversation_id
    WHERE p.account_id = NEW.account_id
      AND p.account_role IN ('owner', 'admin');
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Notifications are helpful but must never prevent the operational task.
  RAISE WARNING 'Failed to notify follow-up task %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.notify_call_follow_up_task() OWNER TO postgres;

DROP TRIGGER IF EXISTS notify_call_follow_up_task ON call_follow_up_tasks;
CREATE TRIGGER notify_call_follow_up_task
  AFTER INSERT ON call_follow_up_tasks
  FOR EACH ROW EXECUTE FUNCTION public.notify_call_follow_up_task();
