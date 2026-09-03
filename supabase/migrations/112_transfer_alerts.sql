-- ============================================================
-- 112 · Transfer alerts for both sides
--
-- Assigning a conversation notified the receiving agent only, and only
-- when a person did it: a queue transfer or an AI handoff was silent, and
-- whoever transferred got no confirmation that it landed.
--
-- Now both sides are told:
--   * the agent receiving it, on any assignment (manual, queue or AI),
--   * the agent who transferred it, so they see it left their hands.
--
-- The trail itself lives in conversation_assignment_history (migration
-- 110); this is only the alert.
-- ============================================================

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'conversation_assigned',
    'conversation_transferred',
    'incoming_message',
    'negative_sentiment',
    'call_follow_up',
    'nexo_memory_alert'
  ));

CREATE OR REPLACE FUNCTION notify_conversation_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_name TEXT;
  v_actor_name TEXT;
  v_target_name TEXT;
  v_queue_name TEXT;
  v_actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_agent_id IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    IF NEW.assigned_agent_id IS NULL
       OR NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM contacts WHERE id = NEW.contact_id;

  IF v_actor IS NOT NULL THEN
    SELECT full_name INTO v_actor_name FROM profiles WHERE user_id = v_actor;
  END IF;

  SELECT name INTO v_queue_name FROM conversation_queues WHERE id = NEW.queue_id;

  -- The agent who receives it. Self-assignment needs no alert.
  IF v_actor IS NULL OR v_actor <> NEW.assigned_agent_id THEN
    INSERT INTO notifications (
      account_id, user_id, type, conversation_id, contact_id, actor_user_id, title, body
    ) VALUES (
      NEW.account_id,
      NEW.assigned_agent_id,
      'conversation_assigned',
      NEW.id,
      NEW.contact_id,
      v_actor,
      'Conversación asignada',
      COALESCE(v_actor_name, CASE WHEN v_queue_name IS NOT NULL THEN 'La cola ' || v_queue_name ELSE 'El sistema' END)
        || ' te asignó la conversación con ' || COALESCE(v_contact_name, 'un contacto')
    );
  END IF;

  -- The agent who transferred it away, so the handoff is visibly closed.
  IF v_actor IS NOT NULL
     AND v_actor <> NEW.assigned_agent_id
     AND TG_OP = 'UPDATE'
     AND OLD.assigned_agent_id IS NOT DISTINCT FROM v_actor THEN
    SELECT full_name INTO v_target_name FROM profiles WHERE user_id = NEW.assigned_agent_id;
    INSERT INTO notifications (
      account_id, user_id, type, conversation_id, contact_id, actor_user_id, title, body
    ) VALUES (
      NEW.account_id,
      v_actor,
      'conversation_transferred',
      NEW.id,
      NEW.contact_id,
      v_actor,
      'Transferencia enviada',
      'Transferiste la conversación con ' || COALESCE(v_contact_name, 'un contacto')
        || ' a ' || COALESCE(v_target_name, 'otro agente')
        || COALESCE(' · cola ' || v_queue_name, '')
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a notification failure block the assignment itself.
  RAISE WARNING 'Failed to create assignment notification for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION notify_conversation_assigned() OWNER TO postgres;

-- Queue moves matter even when the assignee doesn't change, so the trigger
-- has to watch that column too.
DROP TRIGGER IF EXISTS on_conversation_assigned ON conversations;
CREATE TRIGGER on_conversation_assigned
  AFTER INSERT OR UPDATE OF assigned_agent_id, queue_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION notify_conversation_assigned();
