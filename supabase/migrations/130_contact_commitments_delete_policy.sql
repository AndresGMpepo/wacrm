-- ============================================================
-- 130 · contact_commitments: allow agent+ to delete a task
--
-- Migration 097 only granted SELECT/INSERT/UPDATE — deleting a
-- commitment (as opposed to marking it 'cancelled') had no RLS policy
-- at all, so a DELETE from an RLS-scoped client silently affected zero
-- rows. Needed now that the contact sidebar's "Tareas" section lets an
-- agent actually delete a task, not just cancel it.
-- ============================================================

DROP POLICY IF EXISTS contact_commitments_agent_delete ON public.contact_commitments;
CREATE POLICY contact_commitments_agent_delete ON public.contact_commitments
  FOR DELETE USING (is_account_member(account_id, 'agent'));
