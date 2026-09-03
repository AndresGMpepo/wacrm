-- ============================================================
-- 110 · Conversation assignment history
--
-- `conversations.assigned_agent_id` only ever holds the CURRENT owner:
-- every reassignment overwrote the previous one, so "who attended this
-- customer, and who took over afterwards" was unanswerable.
--
-- The history is written by a trigger rather than by the application, so
-- every path is covered — the inbox, the assignment API, the queue RPC,
-- the AI handoff and any future one — without each having to remember.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.conversation_assignment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  -- Denormalized so a contact's trace is one indexed read, and survives
  -- the conversation being reassigned to another contact by a merge.
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  from_agent_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  to_agent_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  queue_id uuid REFERENCES public.conversation_queues(id) ON DELETE SET NULL,
  -- 'manual' = an authenticated user did it; 'automatic' = routing RPC,
  -- AI handoff or automation (service role, no auth.uid()).
  source text NOT NULL CHECK (source IN ('manual', 'automatic', 'released')),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversation_assignment_history_account_idx
  ON public.conversation_assignment_history(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS conversation_assignment_history_conversation_idx
  ON public.conversation_assignment_history(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS conversation_assignment_history_contact_idx
  ON public.conversation_assignment_history(contact_id, created_at DESC);

ALTER TABLE public.conversation_assignment_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_assignment_history_member_select
  ON public.conversation_assignment_history;
CREATE POLICY conversation_assignment_history_member_select
  ON public.conversation_assignment_history
  FOR SELECT USING (is_account_member(account_id));
-- No INSERT/UPDATE/DELETE policy: the trigger below is SECURITY DEFINER,
-- so the trail cannot be written or rewritten from a client session.

CREATE OR REPLACE FUNCTION public.record_conversation_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_previous uuid;
  v_source text;
BEGIN
  v_previous := CASE WHEN TG_OP = 'UPDATE' THEN OLD.assigned_agent_id ELSE NULL END;

  v_source := CASE
    WHEN NEW.assigned_agent_id IS NULL THEN 'released'
    -- Service-role writes (queue RPC, AI handoff, automations) have no
    -- JWT, so auth.uid() is NULL there and a human action is not.
    WHEN auth.uid() IS NOT NULL THEN 'manual'
    ELSE 'automatic'
  END;

  INSERT INTO conversation_assignment_history (
    account_id, conversation_id, contact_id,
    from_agent_id, to_agent_id, queue_id, source, actor_user_id
  ) VALUES (
    NEW.account_id, NEW.id, NEW.contact_id,
    v_previous, NEW.assigned_agent_id, NEW.queue_id, v_source, auth.uid()
  );

  RETURN NULL;
END;
$$;

ALTER FUNCTION public.record_conversation_assignment() OWNER TO postgres;

DROP TRIGGER IF EXISTS conversations_assignment_history_update ON public.conversations;
CREATE TRIGGER conversations_assignment_history_update
  AFTER UPDATE ON public.conversations
  FOR EACH ROW
  WHEN (
    OLD.assigned_agent_id IS DISTINCT FROM NEW.assigned_agent_id
    OR OLD.queue_id IS DISTINCT FROM NEW.queue_id
  )
  EXECUTE FUNCTION public.record_conversation_assignment();

DROP TRIGGER IF EXISTS conversations_assignment_history_insert ON public.conversations;
CREATE TRIGGER conversations_assignment_history_insert
  AFTER INSERT ON public.conversations
  FOR EACH ROW
  WHEN (NEW.assigned_agent_id IS NOT NULL OR NEW.queue_id IS NOT NULL)
  EXECUTE FUNCTION public.record_conversation_assignment();

-- Seed one row per conversation that already has an owner, so existing
-- threads don't start with an empty trace.
INSERT INTO public.conversation_assignment_history (
  account_id, conversation_id, contact_id, from_agent_id, to_agent_id, queue_id, source, created_at
)
SELECT c.account_id, c.id, c.contact_id, NULL, c.assigned_agent_id, c.queue_id, 'automatic', c.created_at
FROM public.conversations c
WHERE c.assigned_agent_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.conversation_assignment_history h WHERE h.conversation_id = c.id
  );
