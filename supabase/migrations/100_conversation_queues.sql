-- Specialized queues (e.g. "Soporte", "Ventas"): route conversations to a
-- named queue and restrict auto-assignment to that queue's own agents.
-- Deliberately additive/backward-compatible: an account that configures no
-- queues (or a conversation with queue_id = NULL) keeps EXACTLY today's
-- behavior — the whole account's active agents, governed by the existing
-- `conversation_assignment_policies` row.
CREATE TABLE IF NOT EXISTS public.conversation_queues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 80),
  is_default boolean NOT NULL DEFAULT false,
  mode text NOT NULL DEFAULT 'round_robin' CHECK (mode IN ('round_robin', 'least_open')),
  last_assigned_agent_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS conversation_queues_account_name_unique ON public.conversation_queues(account_id, lower(name));
-- At most one default ("General") queue per account — it's the implicit
-- whole-account pool, not just a queue with a flag set for fun.
CREATE UNIQUE INDEX IF NOT EXISTS conversation_queues_one_default_per_account ON public.conversation_queues(account_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS conversation_queues_account_idx ON public.conversation_queues(account_id);
ALTER TABLE public.conversation_queues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conversation_queues_member_select ON public.conversation_queues;
CREATE POLICY conversation_queues_member_select ON public.conversation_queues FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS conversation_queues_admin_insert ON public.conversation_queues;
CREATE POLICY conversation_queues_admin_insert ON public.conversation_queues FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS conversation_queues_admin_update ON public.conversation_queues;
CREATE POLICY conversation_queues_admin_update ON public.conversation_queues FOR UPDATE USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS conversation_queues_admin_delete ON public.conversation_queues;
CREATE POLICY conversation_queues_admin_delete ON public.conversation_queues FOR DELETE USING (is_account_member(account_id, 'admin') AND NOT is_default);
DROP TRIGGER IF EXISTS conversation_queues_updated_at ON public.conversation_queues;
CREATE TRIGGER conversation_queues_updated_at BEFORE UPDATE ON public.conversation_queues
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.conversation_queue_members (
  queue_id uuid NOT NULL REFERENCES public.conversation_queues(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (queue_id, user_id)
);
ALTER TABLE public.conversation_queue_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conversation_queue_members_member_select ON public.conversation_queue_members;
CREATE POLICY conversation_queue_members_member_select ON public.conversation_queue_members FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.conversation_queues q WHERE q.id = queue_id AND is_account_member(q.account_id))
);
DROP POLICY IF EXISTS conversation_queue_members_admin_insert ON public.conversation_queue_members;
CREATE POLICY conversation_queue_members_admin_insert ON public.conversation_queue_members FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.conversation_queues q WHERE q.id = queue_id AND is_account_member(q.account_id, 'admin'))
);
DROP POLICY IF EXISTS conversation_queue_members_admin_delete ON public.conversation_queue_members;
CREATE POLICY conversation_queue_members_admin_delete ON public.conversation_queue_members FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.conversation_queues q WHERE q.id = queue_id AND is_account_member(q.account_id, 'admin'))
);

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS queue_id uuid REFERENCES public.conversation_queues(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS conversations_queue_idx ON public.conversations(account_id, queue_id);

-- A connector/channel is routed to a queue at the source: every WhatsApp
-- number / Facebook page / Live Chat widget / Zernio connection can declare
-- which queue its NEW conversations land in. NULL = default/general queue.
ALTER TABLE public.omnichannel_connectors
  ADD COLUMN IF NOT EXISTS queue_id uuid REFERENCES public.conversation_queues(id) ON DELETE SET NULL;
ALTER TABLE public.whatsapp_config
  ADD COLUMN IF NOT EXISTS queue_id uuid REFERENCES public.conversation_queues(id) ON DELETE SET NULL;

-- Every existing account gets a "General" default queue so the Settings UI
-- always has one to show. It starts with zero members on purpose — the RPC
-- below treats a default queue with no members as "the whole account", i.e.
-- exactly today's behavior.
INSERT INTO public.conversation_queues (account_id, name, is_default, mode)
SELECT id, 'General', true, 'round_robin' FROM public.accounts
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.auto_assign_inbound_conversation(
  p_account_id uuid,
  p_conversation_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy conversation_assignment_policies%ROWTYPE;
  v_queue_id uuid;
  v_queue conversation_queues%ROWTYPE;
  v_queue_found boolean := false;
  v_has_members boolean := false;
  v_scoped boolean;
  v_mode text;
  v_last_assigned uuid;
  v_next_agent_id uuid;
  v_updated_conversation_id uuid;
BEGIN
  -- Serialize per-account (matches the pre-queues locking behavior).
  SELECT * INTO v_policy
  FROM conversation_assignment_policies
  WHERE account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND OR NOT v_policy.enabled THEN
    RETURN NULL;
  END IF;

  SELECT queue_id INTO v_queue_id FROM conversations WHERE id = p_conversation_id AND account_id = p_account_id;

  IF v_queue_id IS NOT NULL THEN
    -- Also serialize per-queue so two conversations in the same queue don't
    -- race on its own round-robin cursor.
    SELECT * INTO v_queue FROM conversation_queues WHERE id = v_queue_id AND account_id = p_account_id FOR UPDATE;
    v_queue_found := FOUND;
    IF v_queue_found THEN
      SELECT EXISTS(SELECT 1 FROM conversation_queue_members WHERE queue_id = v_queue_id) INTO v_has_members;
    END IF;
  END IF;

  -- A named (non-default) queue with nobody staffed yet: leave the
  -- conversation unassigned rather than silently pulling from the whole
  -- account — the admin created the queue but hasn't added agents to it.
  IF v_queue_found AND NOT v_queue.is_default AND NOT v_has_members THEN
    RETURN NULL;
  END IF;

  v_scoped := v_queue_found AND v_has_members;
  v_mode := CASE WHEN v_scoped THEN v_queue.mode ELSE v_policy.mode END;
  v_last_assigned := CASE WHEN v_scoped THEN v_queue.last_assigned_agent_id ELSE v_policy.last_assigned_agent_id END;

  IF v_mode = 'least_open' THEN
    SELECT p.user_id INTO v_next_agent_id
    FROM profiles p
    JOIN member_presence mp
      ON mp.user_id = p.user_id
      AND mp.account_id = p.account_id
      AND mp.status = 'online'
      AND mp.last_seen_at >= now() - interval '75 seconds'
    LEFT JOIN conversations c
      ON c.account_id = p.account_id
      AND c.assigned_agent_id = p.user_id
      AND c.status = 'open'
    WHERE p.account_id = p_account_id
      AND p.account_role IN ('owner', 'admin', 'agent')
      AND (NOT v_scoped OR EXISTS (SELECT 1 FROM conversation_queue_members m WHERE m.queue_id = v_queue_id AND m.user_id = p.user_id))
    GROUP BY p.user_id
    ORDER BY count(c.id), p.user_id
    LIMIT 1;
  ELSE
    SELECT p.user_id INTO v_next_agent_id
    FROM profiles p
    JOIN member_presence mp
      ON mp.user_id = p.user_id
      AND mp.account_id = p.account_id
      AND mp.status = 'online'
      AND mp.last_seen_at >= now() - interval '75 seconds'
    WHERE p.account_id = p_account_id
      AND p.account_role IN ('owner', 'admin', 'agent')
      AND (NOT v_scoped OR EXISTS (SELECT 1 FROM conversation_queue_members m WHERE m.queue_id = v_queue_id AND m.user_id = p.user_id))
    ORDER BY
      CASE
        WHEN v_last_assigned IS NULL THEN 0
        WHEN p.user_id > v_last_assigned THEN 0
        ELSE 1
      END,
      p.user_id
    LIMIT 1;
  END IF;

  IF v_next_agent_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE conversations
  SET assigned_agent_id = v_next_agent_id
  WHERE id = p_conversation_id
    AND account_id = p_account_id
    AND assigned_agent_id IS NULL
  RETURNING id INTO v_updated_conversation_id;

  IF v_updated_conversation_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_scoped THEN
    UPDATE conversation_queues SET last_assigned_agent_id = v_next_agent_id, updated_at = now() WHERE id = v_queue_id;
  ELSE
    UPDATE conversation_assignment_policies SET last_assigned_agent_id = v_next_agent_id WHERE account_id = p_account_id;
  END IF;

  RETURN v_next_agent_id;
END;
$$;

ALTER FUNCTION public.auto_assign_inbound_conversation(uuid, uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.auto_assign_inbound_conversation(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_assign_inbound_conversation(uuid, uuid) TO service_role;
