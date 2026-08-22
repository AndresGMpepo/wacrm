CREATE TABLE IF NOT EXISTS public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  assigned_agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 160),
  notes TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_appointments_account_starts_at ON public.appointments(account_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_appointments_account_contact ON public.appointments(account_id, contact_id);

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY appointments_select ON public.appointments FOR SELECT USING (is_account_member(account_id));
CREATE POLICY appointments_insert ON public.appointments FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY appointments_update ON public.appointments FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY appointments_delete ON public.appointments FOR DELETE USING (is_account_member(account_id, 'admin'));

CREATE TRIGGER appointments_updated_at BEFORE UPDATE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();