-- REQ-02: agents only get "new message" notifications for conversations
-- assigned to them or still unassigned — owners/admins keep full visibility.
-- Previously every account profile got notified for every inbound message,
-- regardless of role or assignment (migration 082).

CREATE OR REPLACE FUNCTION public.notify_incoming_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_contact_id uuid;
  v_assigned_agent_id uuid;
  v_contact_name text;
  v_body text;
BEGIN
  IF NEW.sender_type <> 'customer' THEN
    RETURN NEW;
  END IF;

  SELECT c.account_id, c.contact_id, c.assigned_agent_id
    INTO v_account_id, v_contact_id, v_assigned_agent_id
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
  WHERE p.account_id = v_account_id
    AND (
      p.account_role <> 'agent'
      OR v_assigned_agent_id IS NULL
      OR v_assigned_agent_id = p.user_id
    );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create incoming-message notifications for message %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.notify_incoming_message() OWNER TO postgres;
