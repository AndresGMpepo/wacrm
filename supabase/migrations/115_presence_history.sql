-- ============================================================
-- 115 · Presence history
--
-- `member_presence` holds one row per user with the CURRENT status, so
-- "how long was this agent actually connected yesterday" had no answer.
--
-- Sessions are opened and closed by a trigger on the heartbeat, and only
-- when something meaningful happens: a status change, or a gap longer than
-- five minutes (the agent closed the tab and came back). Writing a row per
-- heartbeat would add a write every few seconds per agent for no extra
-- information.
--
-- A session left open because the browser was closed is bounded at read
-- time by the user's last heartbeat — never by `now()`.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.member_presence_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('online', 'away')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE INDEX IF NOT EXISTS member_presence_sessions_account_started_idx
  ON public.member_presence_sessions(account_id, started_at DESC);
CREATE INDEX IF NOT EXISTS member_presence_sessions_open_idx
  ON public.member_presence_sessions(user_id)
  WHERE ended_at IS NULL;

ALTER TABLE public.member_presence_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS member_presence_sessions_admin_select ON public.member_presence_sessions;
CREATE POLICY member_presence_sessions_admin_select ON public.member_presence_sessions
  FOR SELECT USING (is_account_member(account_id, 'admin'));
-- Written only by the trigger below (SECURITY DEFINER).

CREATE OR REPLACE FUNCTION public.track_presence_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gap interval := interval '5 minutes';
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.last_seen_at - OLD.last_seen_at <= v_gap THEN
    RETURN NULL;
  END IF;

  UPDATE member_presence_sessions
  SET ended_at = CASE
    WHEN TG_OP = 'UPDATE' THEN OLD.last_seen_at
    ELSE now()
  END
  WHERE user_id = NEW.user_id AND ended_at IS NULL;

  INSERT INTO member_presence_sessions (account_id, user_id, status, started_at)
  VALUES (NEW.account_id, NEW.user_id, NEW.status, NEW.last_seen_at);

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'presence session tracking failed for user %: %', NEW.user_id, SQLERRM;
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.track_presence_session() OWNER TO postgres;

DROP TRIGGER IF EXISTS member_presence_session_tracking ON public.member_presence;
CREATE TRIGGER member_presence_session_tracking
  AFTER INSERT OR UPDATE ON public.member_presence
  FOR EACH ROW EXECUTE FUNCTION public.track_presence_session();
