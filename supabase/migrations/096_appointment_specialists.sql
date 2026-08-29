-- Specialists are external doctors/professionals the account books
-- appointments with. They are not NexoOmni users/agents: no login, no role,
-- just a name + specialty + an optional Google Calendar.
CREATE TABLE IF NOT EXISTS public.specialists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  full_name text NOT NULL CHECK (char_length(trim(full_name)) BETWEEN 1 AND 160),
  specialty text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS specialists_account_idx ON public.specialists(account_id, is_active);
ALTER TABLE public.specialists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS specialists_member_select ON public.specialists;
CREATE POLICY specialists_member_select ON public.specialists FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS specialists_agent_write ON public.specialists;
CREATE POLICY specialists_agent_write ON public.specialists FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS specialists_agent_update ON public.specialists;
CREATE POLICY specialists_agent_update ON public.specialists FOR UPDATE USING (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS specialists_admin_delete ON public.specialists;
CREATE POLICY specialists_admin_delete ON public.specialists FOR DELETE USING (is_account_member(account_id, 'admin'));
DROP TRIGGER IF EXISTS specialists_updated_at ON public.specialists;
CREATE TRIGGER specialists_updated_at BEFORE UPDATE ON public.specialists
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- A calendar connection now belongs to the general company scope, a
-- specialist, or (legacy, kept read-only) an internal agent.
ALTER TABLE public.google_calendar_connections
  ADD COLUMN IF NOT EXISTS specialist_id uuid REFERENCES public.specialists(id) ON DELETE CASCADE;

DROP INDEX IF EXISTS public.google_calendar_connections_account_calendar_scope_unique;
CREATE UNIQUE INDEX IF NOT EXISTS google_calendar_connections_account_calendar_scope_unique
  ON public.google_calendar_connections (
    account_id, calendar_id,
    COALESCE(assigned_agent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(specialist_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

DROP INDEX IF EXISTS public.google_calendar_connections_one_default_scope_unique;
CREATE UNIQUE INDEX IF NOT EXISTS google_calendar_connections_one_default_scope_unique
  ON public.google_calendar_connections (
    account_id,
    COALESCE(assigned_agent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(specialist_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE is_default;

-- Every connection created before specialists existed used the generic
-- label "Calendario principal" regardless of scope, which read as if every
-- row were "the" main calendar. Re-derive a clear label from its actual scope.
UPDATE public.google_calendar_connections
SET display_name = 'Calendario general de la empresa'
WHERE assigned_agent_id IS NULL AND specialist_id IS NULL AND display_name = 'Calendario principal';

-- An appointment's doctor is independent from the internal agent who books
-- or manages it.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS specialist_id uuid REFERENCES public.specialists(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS appointments_specialist_idx ON public.appointments(account_id, specialist_id);

ALTER TABLE public.google_calendar_oauth_attempts
  ADD COLUMN IF NOT EXISTS specialist_id uuid REFERENCES public.specialists(id) ON DELETE CASCADE;
