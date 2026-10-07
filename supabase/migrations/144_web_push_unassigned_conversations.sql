-- Fixes a gap reported directly by a customer: an unassigned Facebook/
-- Instagram conversation (common — unlike WhatsApp, these rarely arrive
-- already owned by an agent via a broadcast reply) never sent ANY push
-- notification to ANYONE, even though notify_incoming_message() (migration
-- 122) already creates an in-app `notifications` row for every agent
-- (plus every admin/owner) when a conversation is unassigned. The push
-- trigger below required `assigned_agent_id = notification.user_id`
-- exactly, which is never true while the conversation is unassigned — so
-- every one of those rows was silently skipped for push.
--
-- Fix: only gate on the assignee when the conversation IS assigned. An
-- unassigned conversation's notification rows (one per agent, matching
-- notify_incoming_message()'s own policy) now also get a push, so the
-- whole team is alerted until someone takes the conversation.
CREATE OR REPLACE FUNCTION public.enqueue_assigned_message_web_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assigned_agent_id UUID;
BEGIN
  IF NEW.type <> 'incoming_message' OR NEW.conversation_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.assigned_agent_id
    INTO v_assigned_agent_id
  FROM public.conversations c
  WHERE c.id = NEW.conversation_id
    AND c.account_id = NEW.account_id;

  -- Assigned: push only to the assignee (unchanged). Unassigned: push to
  -- every recipient notify_incoming_message() already notified for this
  -- conversation (every agent, plus admins/owners) — matches the in-app
  -- notification's own "everyone until someone takes it" policy instead
  -- of silently dropping push for the whole team.
  IF v_assigned_agent_id IS NOT NULL AND v_assigned_agent_id IS DISTINCT FROM NEW.user_id THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.web_push_outbox (notification_id, account_id, user_id, conversation_id)
  VALUES (NEW.id, NEW.account_id, NEW.user_id, NEW.conversation_id)
  ON CONFLICT (notification_id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to enqueue web push for notification %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enqueue_assigned_message_web_push() OWNER TO postgres;
