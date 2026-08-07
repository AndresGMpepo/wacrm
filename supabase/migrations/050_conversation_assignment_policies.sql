-- Account-level routing for newly created inbound conversations.
-- Selection happens in Postgres so simultaneous WhatsApp webhooks cannot
-- choose the same round-robin member based on stale client-side state.
CREATE TABLE IF NOT EXISTS conversation_assignment_policies (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  mode text NOT NULL DEFAULT 'round_robin'
    CHECK (mode IN ('round_robin', 'least_open')),
  last_assigned_agent_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE conversation_assignment_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_assignment_policies_member_select
  ON conversation_assignment_policies;
CREATE POLICY conversation_assignment_policies_member_select
  ON conversation_assignment_policies FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS conversation_assignment_policies_admin_manage
  ON conversation_assignment_policies;
CREATE POLICY conversation_assignment_policies_admin_manage
  ON conversation_assignment_policies FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS conversation_assignment_policies_updated_at
  ON conversation_assignment_policies;
CREATE TRIGGER conversation_assignment_policies_updated_at
  BEFORE UPDATE ON conversation_assignment_policies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Supports the least-open-load mode without a full conversations scan.
CREATE INDEX IF NOT EXISTS idx_conversations_assignment_load
  ON conversations(account_id, assigned_agent_id)
  WHERE status = 'open';

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
  v_next_agent_id uuid;
  v_updated_conversation_id uuid;
BEGIN
  -- Serialize selection per account so round-robin stays fair even when
  -- multiple webhook deliveries arrive at the same instant.
  SELECT * INTO v_policy
  FROM conversation_assignment_policies
  WHERE account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND OR NOT v_policy.enabled THEN
    RETURN NULL;
  END IF;

  IF v_policy.mode = 'least_open' THEN
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
    ORDER BY
      CASE
        WHEN v_policy.last_assigned_agent_id IS NULL THEN 0
        WHEN p.user_id > v_policy.last_assigned_agent_id THEN 0
        ELSE 1
      END,
      p.user_id
    LIMIT 1;
  END IF;

  -- No online agent is a valid operational state: preserve the unassigned
  -- inbox queue instead of routing work to an absent person.
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

  UPDATE conversation_assignment_policies
  SET last_assigned_agent_id = v_next_agent_id
  WHERE account_id = p_account_id;

  RETURN v_next_agent_id;
END;
$$;

ALTER FUNCTION public.auto_assign_inbound_conversation(uuid, uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.auto_assign_inbound_conversation(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_assign_inbound_conversation(uuid, uuid)
  TO service_role;
