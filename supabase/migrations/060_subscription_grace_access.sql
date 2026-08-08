-- Grace time applies only to an otherwise active/trial subscription.
CREATE OR REPLACE FUNCTION is_account_member(target_account_id UUID, min_role account_role_enum DEFAULT 'viewer')
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p JOIN account_subscriptions s ON s.account_id = p.account_id
    WHERE p.user_id = auth.uid() AND p.account_id = target_account_id AND p.is_active = TRUE
      AND s.status IN ('active', 'trial')
      AND (s.ends_at IS NULL OR s.ends_at + make_interval(days => s.grace_days) > now())
      AND CASE p.account_role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'agent' THEN 2 WHEN 'viewer' THEN 1 END
        >= CASE min_role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'agent' THEN 2 WHEN 'viewer' THEN 1 END
  );
$$;
ALTER FUNCTION is_account_member(UUID, account_role_enum) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_account_member(UUID, account_role_enum) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION current_account_access_status()
RETURNS TABLE(status TEXT, ends_at TIMESTAMPTZ, is_active BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.status, s.ends_at,
    p.is_active AND s.status IN ('active', 'trial')
      AND (s.ends_at IS NULL OR s.ends_at + make_interval(days => s.grace_days) > now())
  FROM profiles p JOIN account_subscriptions s ON s.account_id = p.account_id
  WHERE p.user_id = auth.uid() LIMIT 1;
$$;
ALTER FUNCTION current_account_access_status() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION current_account_access_status() TO authenticated, service_role;
