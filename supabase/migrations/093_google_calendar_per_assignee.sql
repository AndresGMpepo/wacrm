-- A practice can connect one Google Calendar for every doctor or provider.
-- Existing account-level rows remain valid as the fallback connection.
ALTER TABLE public.google_calendar_connections
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS assigned_agent_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.google_calendar_connections
  DROP CONSTRAINT IF EXISTS google_calendar_connections_pkey;

ALTER TABLE public.google_calendar_connections
  ALTER COLUMN id SET NOT NULL,
  ADD PRIMARY KEY (id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_google_calendar_connections_account_assignee
  ON public.google_calendar_connections(account_id, assigned_agent_id)
  WHERE assigned_agent_id IS NOT NULL;

ALTER TABLE public.google_calendar_oauth_attempts
  ADD COLUMN IF NOT EXISTS assigned_agent_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;