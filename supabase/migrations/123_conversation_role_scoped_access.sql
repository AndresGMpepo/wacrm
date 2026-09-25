-- REQ-02 / REQ-04: enforce agent-scoped conversation visibility at the
-- database layer (not just in application queries), so it also governs
-- Supabase Realtime's postgres_changes payloads (which apply RLS) — an
-- agent's browser must never even receive a WS event for a conversation
-- assigned to a different agent.
--
-- Rule: an agent (account_role = 'agent') may see a conversation only if
-- it is unassigned OR assigned to them. Owners, admins and viewers keep
-- full account-wide visibility (they are "roles superiores" and are
-- excluded from the agent-only restriction).
--
-- Applies to `conversations` directly and to `messages` /
-- `message_reactions` transitively (both join back to `conversations`).
CREATE OR REPLACE FUNCTION public.can_view_conversation(
  p_account_id uuid,
  p_assigned_agent_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    is_account_member(p_account_id)
    AND (
      p_assigned_agent_id IS NULL
      OR p_assigned_agent_id = auth.uid()
      OR NOT EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.user_id = auth.uid()
          AND p.account_id = p_account_id
          AND p.account_role = 'agent'
      )
    )
$$;

ALTER FUNCTION public.can_view_conversation(uuid, uuid) OWNER TO postgres;

DROP POLICY IF EXISTS conversations_select ON public.conversations;
CREATE POLICY conversations_select ON public.conversations FOR SELECT USING (
  public.can_view_conversation(account_id, assigned_agent_id)
);

DROP POLICY IF EXISTS messages_select ON public.messages;
CREATE POLICY messages_select ON public.messages FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id
      AND public.can_view_conversation(c.account_id, c.assigned_agent_id)
  )
);

DROP POLICY IF EXISTS message_reactions_select ON public.message_reactions;
CREATE POLICY message_reactions_select ON public.message_reactions FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.id = message_reactions.message_id
      AND public.can_view_conversation(c.account_id, c.assigned_agent_id)
  )
);
