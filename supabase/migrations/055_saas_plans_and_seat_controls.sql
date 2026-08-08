-- ============================================================
-- 055_saas_plans_and_seat_controls.sql
-- Commercial controls for a seat-based WACRM deployment.
-- ============================================================

CREATE TABLE IF NOT EXISTS account_subscriptions (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL DEFAULT 'ai'
    CHECK (plan_code IN ('ai', 'yeastar_voice', 'whatsapp_voice')),
  seat_limit INTEGER NOT NULL DEFAULT 1 CHECK (seat_limit >= 1),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'trial', 'suspended', 'cancelled')),
  feature_overrides JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(feature_overrides) = 'object'),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_subscriptions_status
  ON account_subscriptions(status);

DROP TRIGGER IF EXISTS set_updated_at ON account_subscriptions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON account_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE account_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS account_subscriptions_select ON account_subscriptions;
CREATE POLICY account_subscriptions_select ON account_subscriptions FOR SELECT
  USING (is_account_member(account_id));
-- No client mutation policy: commercial changes belong to the platform operator.

-- Preserve existing PBX installations and existing member counts.
INSERT INTO account_subscriptions (account_id, plan_code, seat_limit)
SELECT
  a.id,
  CASE WHEN EXISTS (
    SELECT 1 FROM telephony_configs tc
    WHERE tc.account_id = a.id AND tc.provider = 'yeastar'
  ) THEN 'yeastar_voice' ELSE 'ai' END,
  GREATEST(1, COUNT(p.user_id))::INTEGER
FROM accounts a
LEFT JOIN profiles p ON p.account_id = a.id
GROUP BY a.id
ON CONFLICT (account_id) DO NOTHING;

CREATE OR REPLACE FUNCTION enforce_account_seat_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER;
  v_status TEXT;
  v_members INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id THEN
    RETURN NEW;
  END IF;

  SELECT seat_limit, status INTO v_limit, v_status
  FROM account_subscriptions
  WHERE account_id = NEW.account_id;

  IF v_limit IS NULL OR v_status NOT IN ('active', 'trial') THEN
    RAISE EXCEPTION 'The account is not provisioned for new members'
      USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_members
  FROM profiles
  WHERE account_id = NEW.account_id
    AND user_id IS DISTINCT FROM NEW.user_id;

  IF v_members >= v_limit THEN
    RAISE EXCEPTION 'The contracted user limit (%) has been reached', v_limit
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION enforce_account_seat_limit() OWNER TO postgres;
DROP TRIGGER IF EXISTS enforce_account_seat_limit_on_profile ON profiles;
CREATE TRIGGER enforce_account_seat_limit_on_profile
  BEFORE INSERT OR UPDATE OF account_id ON profiles
  FOR EACH ROW EXECUTE FUNCTION enforce_account_seat_limit();

-- Tenant admins can no longer create user access. Existing outstanding
-- links are expired during the policy transition.
UPDATE account_invitations
SET expires_at = NOW()
WHERE accepted_at IS NULL AND expires_at > NOW();
