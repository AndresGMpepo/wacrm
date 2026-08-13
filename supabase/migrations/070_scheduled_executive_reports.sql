-- Scheduled executive report delivery. All rows remain account scoped and
-- only account administrators can manage their own schedules.

CREATE TABLE IF NOT EXISTS public.executive_report_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Reporte ejecutivo' CHECK (char_length(name) BETWEEN 1 AND 120),
  enabled BOOLEAN NOT NULL DEFAULT true,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'once')),
  scheduled_time TIME NOT NULL DEFAULT '08:00:00',
  timezone TEXT NOT NULL DEFAULT 'America/Mexico_City',
  weekday SMALLINT CHECK (weekday BETWEEN 0 AND 6),
  monthday SMALLINT CHECK (monthday BETWEEN 1 AND 31),
  once_at TIMESTAMPTZ,
  report_days INTEGER NOT NULL DEFAULT 7 CHECK (report_days BETWEEN 1 AND 365),
  recipients TEXT[] NOT NULL CHECK (cardinality(recipients) BETWEEN 1 AND 10),
  next_run_at TIMESTAMPTZ NOT NULL,
  last_sent_at TIMESTAMPTZ,
  last_error TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (frequency = 'daily' AND weekday IS NULL AND monthday IS NULL AND once_at IS NULL)
    OR (frequency = 'weekly' AND weekday IS NOT NULL AND monthday IS NULL AND once_at IS NULL)
    OR (frequency = 'monthly' AND weekday IS NULL AND monthday IS NOT NULL AND once_at IS NULL)
    OR (frequency = 'once' AND weekday IS NULL AND monthday IS NULL AND once_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_executive_report_schedules_due
  ON public.executive_report_schedules(next_run_at)
  WHERE enabled = true;

CREATE TABLE IF NOT EXISTS public.executive_report_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  schedule_id UUID NOT NULL REFERENCES public.executive_report_schedules(id) ON DELETE CASCADE,
  scheduled_for TIMESTAMPTZ NOT NULL,
  range_from DATE NOT NULL,
  range_to DATE NOT NULL,
  recipients TEXT[] NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  provider_message_id TEXT,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, scheduled_for)
);

ALTER TABLE public.executive_report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executive_report_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS executive_report_schedules_admin ON public.executive_report_schedules;
CREATE POLICY executive_report_schedules_admin ON public.executive_report_schedules
  FOR ALL TO authenticated
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS executive_report_deliveries_admin_select ON public.executive_report_deliveries;
CREATE POLICY executive_report_deliveries_admin_select ON public.executive_report_deliveries
  FOR SELECT TO authenticated
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS executive_report_schedules_updated_at ON public.executive_report_schedules;
CREATE TRIGGER executive_report_schedules_updated_at
  BEFORE UPDATE ON public.executive_report_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.executive_report_schedules IS
  'Account-scoped recurring executive report configurations. Delivery is performed by the protected application worker.';
