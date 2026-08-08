-- Commercial metadata and immutable operator audit. Tenant members never read these records.
ALTER TABLE public.account_subscriptions
  ADD COLUMN IF NOT EXISTS grace_days INTEGER NOT NULL DEFAULT 0 CHECK (grace_days BETWEEN 0 AND 90),
  ADD COLUMN IF NOT EXISTS contract_reference TEXT,
  ADD COLUMN IF NOT EXISTS invoice_reference TEXT,
  ADD COLUMN IF NOT EXISTS internal_notes TEXT;

CREATE TABLE IF NOT EXISTS public.platform_commercial_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  account_name TEXT NOT NULL,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_commercial_audit_account_created
  ON public.platform_commercial_audit(account_id, created_at DESC);
ALTER TABLE public.platform_commercial_audit ENABLE ROW LEVEL SECURITY;
