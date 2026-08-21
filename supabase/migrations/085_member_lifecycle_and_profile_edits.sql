CREATE TABLE IF NOT EXISTS public.member_profile_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  member_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL CHECK (action IN ('profile_updated', 'deactivated', 'reactivated')),
  before_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_member_profile_audit_account_created
  ON public.member_profile_audit(account_id, created_at DESC);

ALTER TABLE public.member_profile_audit ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.update_member_profile(
  p_user_id UUID,
  p_full_name TEXT DEFAULT NULL,
  p_avatar_url TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_caller_role account_role_enum;
  v_old RECORD;
  v_action TEXT;
BEGIN
  SELECT account_id, account_role INTO v_account_id, v_caller_role
  FROM profiles WHERE user_id = auth.uid();
  IF v_account_id IS NULL OR v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher' USING ERRCODE = '42501';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Use your own profile settings to edit yourself' USING ERRCODE = '22023';
  END IF;

  SELECT user_id, full_name, avatar_url, is_active, account_role
  INTO v_old
  FROM profiles
  WHERE user_id = p_user_id AND account_id = v_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user is not a member of your account' USING ERRCODE = '42501';
  END IF;
  IF v_old.account_role = 'owner' THEN
    RAISE EXCEPTION 'The account owner cannot be edited here' USING ERRCODE = '22023';
  END IF;

  UPDATE profiles SET
    full_name = COALESCE(NULLIF(trim(p_full_name), ''), full_name),
    avatar_url = CASE WHEN p_avatar_url IS NULL THEN avatar_url ELSE NULLIF(trim(p_avatar_url), '') END,
    is_active = COALESCE(p_is_active, is_active),
    updated_at = NOW()
  WHERE user_id = p_user_id AND account_id = v_account_id;

  v_action := CASE
    WHEN p_is_active = FALSE THEN 'deactivated'
    WHEN p_is_active = TRUE AND v_old.is_active = FALSE THEN 'reactivated'
    ELSE 'profile_updated'
  END;

  INSERT INTO member_profile_audit(account_id, member_user_id, actor_user_id, action, before_data, after_data)
  SELECT v_account_id, p_user_id, auth.uid(), v_action,
    jsonb_build_object('full_name', v_old.full_name, 'avatar_url', v_old.avatar_url, 'is_active', v_old.is_active),
    jsonb_build_object('full_name', full_name, 'avatar_url', avatar_url, 'is_active', is_active)
  FROM profiles WHERE user_id = p_user_id AND account_id = v_account_id;
END;
$$;

ALTER FUNCTION public.update_member_profile(UUID, TEXT, TEXT, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_member_profile(UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_member_profile(UUID, TEXT, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_account_seat_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_limit INTEGER; v_status TEXT; v_ends_at TIMESTAMPTZ; v_members INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active THEN RETURN NEW; END IF;
  SELECT seat_limit, status, ends_at INTO v_limit, v_status, v_ends_at FROM account_subscriptions WHERE account_id = NEW.account_id;
  IF v_limit IS NULL OR v_status NOT IN ('active', 'trial') OR (v_ends_at IS NOT NULL AND v_ends_at <= NOW()) THEN
    RAISE EXCEPTION 'The account is not active for new members' USING ERRCODE = '42501';
  END IF;
  IF NEW.is_active = FALSE THEN RETURN NEW; END IF;
  SELECT COUNT(*)::INTEGER INTO v_members FROM profiles WHERE account_id = NEW.account_id AND is_active = TRUE AND user_id IS DISTINCT FROM NEW.user_id;
  IF v_members >= v_limit THEN RAISE EXCEPTION 'The contracted user limit (%) has been reached', v_limit USING ERRCODE = '22023'; END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.enforce_account_seat_limit() OWNER TO postgres;
DROP TRIGGER IF EXISTS enforce_account_seat_limit_on_profile ON profiles;
CREATE TRIGGER enforce_account_seat_limit_on_profile
  BEFORE INSERT OR UPDATE OF account_id, is_active ON profiles
  FOR EACH ROW EXECUTE FUNCTION enforce_account_seat_limit();
