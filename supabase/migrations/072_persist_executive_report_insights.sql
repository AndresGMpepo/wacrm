-- The stored insight is only read back. It never invokes an AI provider.
CREATE TABLE IF NOT EXISTS public.executive_report_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  range_from DATE NOT NULL,
  range_to DATE NOT NULL,
  insight JSONB NOT NULL,
  generated_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (range_from <= range_to),
  UNIQUE (account_id, range_from, range_to)
);

CREATE INDEX IF NOT EXISTS idx_executive_report_insights_account_generated
  ON public.executive_report_insights(account_id, generated_at DESC);

ALTER TABLE public.executive_report_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS executive_report_insights_admin_select ON public.executive_report_insights;
CREATE POLICY executive_report_insights_admin_select ON public.executive_report_insights
  FOR SELECT TO authenticated
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS executive_report_insights_admin_insert ON public.executive_report_insights;
CREATE POLICY executive_report_insights_admin_insert ON public.executive_report_insights
  FOR INSERT TO authenticated
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS executive_report_insights_admin_update ON public.executive_report_insights;
CREATE POLICY executive_report_insights_admin_update ON public.executive_report_insights
  FOR UPDATE TO authenticated
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS executive_report_insights_updated_at ON public.executive_report_insights;
CREATE TRIGGER executive_report_insights_updated_at
  BEFORE UPDATE ON public.executive_report_insights
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.executive_report_insights IS
  'Last manually generated executive AI insight per account and report date range.';
