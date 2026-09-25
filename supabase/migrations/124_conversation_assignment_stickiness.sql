-- REQ-05: continuous routing (stickiness) + backup agent fallback.
--
--   1. Stickiness — a contact who writes again is routed back to
--      whichever agent most recently handled one of their conversations,
--      bypassing rotation entirely, as long as that agent is still a
--      valid, active, online candidate (not deactivated / offline).
--   2. Backup agent — when the previous agent is unavailable, the
--      conversation goes to the account's configured backup agent
--      (also validated active + online) instead of falling straight to
--      round-robin/least-open.
--   3. Only when neither applies does the existing rotation logic run.
--
-- Both are gated behind the same `conversation_assignment_policies.enabled`
-- toggle as the rest of auto-assignment (an account that has automatic
-- assignment turned off keeps today's "stays unassigned" behavior).
--
-- Shared by every inbound channel (native WhatsApp Cloud API, Zernio
-- WhatsApp/Facebook/Instagram, Meta direct, Yeastar live chat) since they
-- all call the same `auto_assign_inbound_conversation` RPC.
ALTER TABLE public.conversation_assignment_policies
  ADD COLUMN IF NOT EXISTS backup_agent_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Single-candidate eligibility check reused for both stickiness and the
-- backup agent — active membership, a role that can hold conversations,
-- online presence, and (when the conversation belongs to a staffed named
-- queue) membership in that queue.
CREATE OR REPLACE FUNCTION public.is_conversation_agent_assignable(
  p_account_id uuid,
  p_user_id uuid,
  p_scoped boolean,
  p_queue_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    JOIN member_presence mp
      ON mp.user_id = p.user_id
      AND mp.account_id = p.account_id
      AND mp.status = 'online'
      AND mp.last_seen_at >= now() - interval '75 seconds'
    WHERE p.user_id = p_user_id
      AND p.account_id = p_account_id
      AND p.is_active = true
      AND p.account_role IN ('owner', 'admin', 'agent')
      AND (
        NOT p_scoped
        OR EXISTS (
          SELECT 1 FROM conversation_queue_members m
          WHERE m.queue_id = p_queue_id AND m.user_id = p_user_id
        )
      )
  )
$$;

ALTER FUNCTION public.is_conversation_agent_assignable(uuid, uuid, boolean, uuid) OWNER TO postgres;

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
  v_contact_id uuid;
  v_sticky_agent_id uuid;
  v_is_override boolean := false;
BEGIN
  -- Serialize per-account (matches the pre-queues locking behavior).
  SELECT * INTO v_policy
  FROM conversation_assignment_policies
  WHERE account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND OR NOT v_policy.enabled THEN
    RETURN NULL;
  END IF;

  SELECT queue_id, contact_id INTO v_queue_id, v_contact_id
  FROM conversations WHERE id = p_conversation_id AND account_id = p_account_id;

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

  -- REQ-05, step 1: stickiness. Find the agent who most recently handled
  -- ANY other conversation with this same contact.
  IF v_contact_id IS NOT NULL THEN
    SELECT c2.assigned_agent_id INTO v_sticky_agent_id
    FROM conversations c2
    WHERE c2.account_id = p_account_id
      AND c2.contact_id = v_contact_id
      AND c2.id <> p_conversation_id
      AND c2.assigned_agent_id IS NOT NULL
    ORDER BY c2.updated_at DESC
    LIMIT 1;
  END IF;

  IF v_sticky_agent_id IS NOT NULL
     AND public.is_conversation_agent_assignable(p_account_id, v_sticky_agent_id, v_scoped, v_queue_id) THEN
    v_next_agent_id := v_sticky_agent_id;
    v_is_override := true;
  -- REQ-05, step 2: previous agent unavailable — fall back to the
  -- account's configured backup agent, if one is set and available.
  ELSIF v_policy.backup_agent_id IS NOT NULL
     AND public.is_conversation_agent_assignable(p_account_id, v_policy.backup_agent_id, v_scoped, v_queue_id) THEN
    v_next_agent_id := v_policy.backup_agent_id;
    v_is_override := true;
  ELSE
    -- REQ-05, step 3 (unchanged): neither stickiness nor backup applied —
    -- run the account/queue's normal rotation policy.
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
        AND p.is_active = true
        -- REQ-04: roles superiores never enter automatic rotation.
        AND p.account_role = 'agent'
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
        AND p.is_active = true
        -- REQ-04: roles superiores never enter automatic rotation.
        AND p.account_role = 'agent'
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

  -- Stickiness/backup picks are overrides, not rotation turns — only
  -- algorithmic picks advance the round-robin/least-open cursor.
  IF NOT v_is_override THEN
    IF v_scoped THEN
      UPDATE conversation_queues SET last_assigned_agent_id = v_next_agent_id, updated_at = now() WHERE id = v_queue_id;
    ELSE
      UPDATE conversation_assignment_policies SET last_assigned_agent_id = v_next_agent_id WHERE account_id = p_account_id;
    END IF;
  END IF;

  RETURN v_next_agent_id;
END;
$$;

ALTER FUNCTION public.auto_assign_inbound_conversation(uuid, uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.auto_assign_inbound_conversation(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_assign_inbound_conversation(uuid, uuid) TO service_role;
