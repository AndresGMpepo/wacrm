-- Multiple Google calendars per account/responsible, plus an immutable audit trail.
ALTER TABLE public.google_calendar_connections
  ADD COLUMN IF NOT EXISTS display_name text NOT NULL DEFAULT 'Calendario principal',
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sync_token text,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text;

DROP INDEX IF EXISTS public.google_calendar_connections_account_agent_unique;
DROP INDEX IF EXISTS public.idx_google_calendar_connections_account_assignee;
CREATE UNIQUE INDEX IF NOT EXISTS google_calendar_connections_account_calendar_scope_unique
  ON public.google_calendar_connections (account_id, calendar_id, COALESCE(assigned_agent_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE UNIQUE INDEX IF NOT EXISTS google_calendar_connections_one_default_scope_unique
  ON public.google_calendar_connections (account_id, COALESCE(assigned_agent_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE is_default;

UPDATE public.google_calendar_connections c
SET is_default = true
WHERE c.id IN (
  SELECT DISTINCT ON (account_id, COALESCE(assigned_agent_id, '00000000-0000-0000-0000-000000000000'::uuid)) id
  FROM public.google_calendar_connections
  ORDER BY account_id, COALESCE(assigned_agent_id, '00000000-0000-0000-0000-000000000000'::uuid), connected_at ASC
);

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS google_calendar_connection_id uuid REFERENCES public.google_calendar_connections(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS appointments_google_calendar_connection_idx ON public.appointments(google_calendar_connection_id);

UPDATE public.appointments a
SET google_calendar_connection_id = c.id
FROM public.google_calendar_connections c
WHERE a.google_calendar_connection_id IS NULL
  AND c.account_id = a.account_id
  AND c.is_default = true
  AND c.assigned_agent_id = a.assigned_agent_id;

UPDATE public.appointments a
SET google_calendar_connection_id = c.id
FROM public.google_calendar_connections c
WHERE a.google_calendar_connection_id IS NULL
  AND c.account_id = a.account_id
  AND c.is_default = true
  AND c.assigned_agent_id IS NULL;

CREATE TABLE IF NOT EXISTS public.appointment_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  actor_user_id uuid,
  source text NOT NULL CHECK (source IN ('nexoomni', 'google_calendar')),
  action text NOT NULL,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS appointment_audit_log_account_created_idx ON public.appointment_audit_log(account_id, created_at DESC);
ALTER TABLE public.appointment_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.appointment_audit_log FROM anon;
GRANT SELECT, INSERT ON TABLE public.appointment_audit_log TO authenticated;
DROP POLICY IF EXISTS appointment_audit_log_member_select ON public.appointment_audit_log;
CREATE POLICY appointment_audit_log_member_select ON public.appointment_audit_log FOR SELECT TO authenticated USING (is_account_member(account_id));
DROP POLICY IF EXISTS appointment_audit_log_member_insert ON public.appointment_audit_log;
CREATE POLICY appointment_audit_log_member_insert ON public.appointment_audit_log FOR INSERT TO authenticated
  WITH CHECK (is_account_member(account_id) AND actor_user_id = (SELECT auth.uid()));
