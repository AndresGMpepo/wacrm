-- ============================================================
-- 058_platform_member_access_controls.sql
-- Per-user commercial access controls. A paused employee keeps their
-- history and consumes their contracted seat, but cannot read tenant data.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_profiles_account_active
  ON public.profiles(account_id, is_active);

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
      AND p.is_active = TRUE
      AND subscription.status IN ('active', 'trial')
      AND (subscription.ends_at IS NULL OR subscription.ends_at > NOW())
      AND CASE p.account_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END >= CASE min_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
  );
$$;

ALTER FUNCTION is_account_member(UUID, account_role_enum) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_account_member(UUID, account_role_enum) TO authenticated, service_role;

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
    profile.is_active
      AND subscription.status IN ('active', 'trial')
      AND (subscription.ends_at IS NULL OR subscription.ends_at > NOW()) AS is_active
  FROM profiles profile
  JOIN account_subscriptions subscription ON subscription.account_id = profile.account_id
  WHERE profile.user_id = auth.uid()
  LIMIT 1;
$$;

ALTER FUNCTION current_account_access_status() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION current_account_access_status() TO authenticated, service_role;
