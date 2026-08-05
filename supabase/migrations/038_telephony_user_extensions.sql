-- The PBX integration credentials are account-wide, but a SIP/Linkus
-- extension belongs to exactly one WACRM user. Keeping it on
-- telephony_configs caused the last user to save their extension to replace
-- every other user's softphone identity.
CREATE TABLE IF NOT EXISTS telephony_user_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'yeastar' CHECK (provider IN ('yeastar', 'sip')),
  extension TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, user_id, provider)
);

-- Existing account-wide values are deliberately not copied. Their owner is
-- ambiguous, and copying one would reconnect somebody as the wrong extension.
-- Each user must explicitly save their assigned extension once after upgrade.

ALTER TABLE telephony_user_configs ENABLE ROW LEVEL SECURITY;
-- Route handlers use the service role only after requireRole() checks the
-- caller; no browser policy may expose another user's extension assignment.

CREATE OR REPLACE FUNCTION public.update_telephony_user_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS telephony_user_configs_updated_at ON telephony_user_configs;
CREATE TRIGGER telephony_user_configs_updated_at
BEFORE UPDATE ON telephony_user_configs
FOR EACH ROW EXECUTE FUNCTION public.update_telephony_user_configs_updated_at();
