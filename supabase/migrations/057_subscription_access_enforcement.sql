-- ============================================================
-- 057_subscription_access_enforcement.sql
-- A paused, cancelled, or expired tenant loses data access at the
-- database policy boundary. Data is retained; only the platform
-- operator can reactivate or delete it deliberately.
-- ============================================================

CREATE OR REPLACE FUNCTION is_account_member(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    JOIN account_subscriptions subscription
      ON subscription.account_id = p.account_id
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND subscription.status IN ('active', 'trial')
      AND (subscription.ends_at IS NULL OR subscription.ends_at > NOW())
      AND CASE p.account_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
        >=
          CASE min_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
  );
$$;

ALTER FUNCTION is_account_member(UUID, account_role_enum) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_account_member(UUID, account_role_enum) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION enforce_account_seat_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER;
  v_status TEXT;
  v_ends_at TIMESTAMPTZ;
  v_members INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id THEN
    RETURN NEW;
  END IF;

  SELECT seat_limit, status, ends_at INTO v_limit, v_status, v_ends_at
  FROM account_subscriptions
  WHERE account_id = NEW.account_id;

  IF v_limit IS NULL
     OR v_status NOT IN ('active', 'trial')
     OR (v_ends_at IS NOT NULL AND v_ends_at <= NOW()) THEN
    RAISE EXCEPTION 'The account is not active for new members'
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

-- Middleware may read this minimal status even after tenant RLS denies normal
-- data access, allowing WACRM to show a clear commercial suspension screen.
CREATE OR REPLACE FUNCTION current_account_access_status()
RETURNS TABLE(status TEXT, ends_at TIMESTAMPTZ, is_active BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    subscription.status,
    subscription.ends_at,
    subscription.status IN ('active', 'trial')
      AND (subscription.ends_at IS NULL OR subscription.ends_at > NOW()) AS is_active
  FROM profiles profile
  JOIN account_subscriptions subscription ON subscription.account_id = profile.account_id
  WHERE profile.user_id = auth.uid()
  LIMIT 1;
$$;

ALTER FUNCTION current_account_access_status() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION current_account_access_status() TO authenticated, service_role;
