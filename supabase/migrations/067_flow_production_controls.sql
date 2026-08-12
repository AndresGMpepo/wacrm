-- Production controls for NexoOmni Flows.
-- Account members can inspect definitions and run history, while only
-- owners/admins can alter the automation logic. API routes enforce the
-- matching commercial entitlement; these policies remain defense in depth
-- for direct Data API access.

ALTER TABLE public.flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flow_nodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS flows_insert ON public.flows;
DROP POLICY IF EXISTS flows_update ON public.flows;
DROP POLICY IF EXISTS flows_delete ON public.flows;

CREATE POLICY flows_insert ON public.flows
  FOR INSERT TO authenticated
  WITH CHECK (is_account_member(account_id, 'admin'));

CREATE POLICY flows_update ON public.flows
  FOR UPDATE TO authenticated
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

CREATE POLICY flows_delete ON public.flows
  FOR DELETE TO authenticated
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS flow_nodes_modify ON public.flow_nodes;

CREATE POLICY flow_nodes_modify ON public.flow_nodes
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.flows f
      WHERE f.id = flow_nodes.flow_id
        AND is_account_member(f.account_id, 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.flows f
      WHERE f.id = flow_nodes.flow_id
        AND is_account_member(f.account_id, 'admin')
    )
  );
