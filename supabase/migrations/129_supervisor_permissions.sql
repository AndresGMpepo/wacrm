-- ============================================================
-- 129 · Supervisor permissions
--
-- 1. Re-ranks is_account_member() so 'supervisor' sits between 'agent'
--    and 'admin' (owner=5, admin=4, supervisor=3, agent=2, viewer=1).
--    Every existing is_account_member(account_id, 'admin') check keeps
--    excluding supervisor automatically (rank-based comparison) unless
--    explicitly widened below — Settings, integrations, billing,
--    Automations/Flows and AI Agents config stay admin+-only.
--
-- 2. Widens the specific RLS policies backing the 4 menus a supervisor
--    should fully use: Reports (executive_report_schedules/deliveries/
--    insights), Call transcriptions (no table-level admin RLS — gated
--    in the API route instead, see src/lib/account/entitlements.ts),
--    and Supervision (supervision_interventions, agent_activity_log,
--    member_presence_sessions). Broadcasts has no admin-only RLS to
--    begin with (already agent+-accessible), so nothing to widen there.
-- ============================================================

CREATE OR REPLACE FUNCTION is_account_member(target_account_id UUID, min_role account_role_enum DEFAULT 'viewer')
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p JOIN account_subscriptions s ON s.account_id = p.account_id
    WHERE p.user_id = auth.uid() AND p.account_id = target_account_id AND p.is_active = TRUE
      AND s.status IN ('active', 'trial')
      AND (s.ends_at IS NULL OR s.ends_at + make_interval(days => s.grace_days) > now())
      AND CASE p.account_role WHEN 'owner' THEN 5 WHEN 'admin' THEN 4 WHEN 'supervisor' THEN 3 WHEN 'agent' THEN 2 WHEN 'viewer' THEN 1 END
        >= CASE min_role WHEN 'owner' THEN 5 WHEN 'admin' THEN 4 WHEN 'supervisor' THEN 3 WHEN 'agent' THEN 2 WHEN 'viewer' THEN 1 END
  );
$$;
ALTER FUNCTION is_account_member(UUID, account_role_enum) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_account_member(UUID, account_role_enum) TO authenticated, service_role;

-- ---- Reports ----------------------------------------------------
DROP POLICY IF EXISTS executive_report_schedules_admin ON public.executive_report_schedules;
CREATE POLICY executive_report_schedules_admin ON public.executive_report_schedules
  FOR ALL TO authenticated
  USING (is_account_member(account_id, 'supervisor'))
  WITH CHECK (is_account_member(account_id, 'supervisor'));

DROP POLICY IF EXISTS executive_report_deliveries_admin_select ON public.executive_report_deliveries;
CREATE POLICY executive_report_deliveries_admin_select ON public.executive_report_deliveries
  FOR SELECT TO authenticated
  USING (is_account_member(account_id, 'supervisor'));

DROP POLICY IF EXISTS executive_report_insights_admin_select ON public.executive_report_insights;
CREATE POLICY executive_report_insights_admin_select ON public.executive_report_insights
  FOR SELECT TO authenticated
  USING (is_account_member(account_id, 'supervisor'));

DROP POLICY IF EXISTS executive_report_insights_admin_insert ON public.executive_report_insights;
CREATE POLICY executive_report_insights_admin_insert ON public.executive_report_insights
  FOR INSERT TO authenticated
  WITH CHECK (is_account_member(account_id, 'supervisor'));

DROP POLICY IF EXISTS executive_report_insights_admin_update ON public.executive_report_insights;
CREATE POLICY executive_report_insights_admin_update ON public.executive_report_insights
  FOR UPDATE TO authenticated
  USING (is_account_member(account_id, 'supervisor'))
  WITH CHECK (is_account_member(account_id, 'supervisor'));

-- ---- Supervision --------------------------------------------------
DROP POLICY IF EXISTS supervision_interventions_admin_read ON supervision_interventions;
CREATE POLICY supervision_interventions_admin_read ON supervision_interventions
  FOR SELECT USING (is_account_member(account_id, 'supervisor'));

DROP POLICY IF EXISTS supervision_interventions_admin_write ON supervision_interventions;
CREATE POLICY supervision_interventions_admin_write ON supervision_interventions
  FOR ALL USING (is_account_member(account_id, 'supervisor'))
  WITH CHECK (is_account_member(account_id, 'supervisor'));

DROP POLICY IF EXISTS agent_activity_log_admin_select ON public.agent_activity_log;
CREATE POLICY agent_activity_log_admin_select ON public.agent_activity_log
  FOR SELECT USING (is_account_member(account_id, 'supervisor'));

DROP POLICY IF EXISTS member_presence_sessions_admin_select ON public.member_presence_sessions;
CREATE POLICY member_presence_sessions_admin_select ON public.member_presence_sessions
  FOR SELECT USING (is_account_member(account_id, 'supervisor'));
