-- ============================================================
-- 111 · Support sessions
--
-- A platform operator could manage a tenant's commercial record but had no
-- way to look inside the account to help. Rather than granting a standing
-- back door, access is an explicit, time-boxed session: the operator states
-- a reason, the session expires on its own, and every read is written to
-- the operator audit trail.
--
-- Tenant members never read this table; it is operator-only, so there is no
-- SELECT policy — the routes use the service role.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.platform_support_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  operator_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Kept verbatim: the operator allow-list is an env var of emails, so the
  -- email is the durable identity even if the auth user is later removed.
  operator_email text NOT NULL,
  reason text NOT NULL CHECK (char_length(trim(reason)) BETWEEN 3 AND 300),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_support_sessions_active_idx
  ON public.platform_support_sessions(account_id, expires_at DESC)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS platform_support_sessions_operator_idx
  ON public.platform_support_sessions(operator_email, created_at DESC);

ALTER TABLE public.platform_support_sessions ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: unreachable from any tenant session.
