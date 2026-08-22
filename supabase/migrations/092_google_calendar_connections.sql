CREATE TABLE IF NOT EXISTS public.google_calendar_connections (
  account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  access_token_expires_at TIMESTAMPTZ,
  connected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.google_calendar_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY google_calendar_connections_admin_select ON public.google_calendar_connections
  FOR SELECT USING (is_account_member(account_id, 'admin'));

CREATE TABLE IF NOT EXISTS public.google_calendar_oauth_attempts (
  state UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ
);

ALTER TABLE public.google_calendar_oauth_attempts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS google_calendar_event_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_google_calendar_event
  ON public.appointments(account_id, google_calendar_event_id)
  WHERE google_calendar_event_id IS NOT NULL;