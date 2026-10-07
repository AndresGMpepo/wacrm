CREATE TABLE public.web_push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'es' CHECK (locale IN ('es', 'en', 'ko')),
  expiration_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX web_push_subscriptions_user_idx
  ON public.web_push_subscriptions(user_id);

ALTER TABLE public.web_push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY web_push_subscriptions_select_self
  ON public.web_push_subscriptions FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND public.is_account_member(account_id, 'agent')
  );
CREATE POLICY web_push_subscriptions_insert_self
  ON public.web_push_subscriptions FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_account_member(account_id, 'agent')
  );
CREATE POLICY web_push_subscriptions_update_self
  ON public.web_push_subscriptions FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND public.is_account_member(account_id, 'agent')
  )
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_account_member(account_id, 'agent')
  );
CREATE POLICY web_push_subscriptions_delete_self
  ON public.web_push_subscriptions FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    AND public.is_account_member(account_id, 'agent')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.web_push_subscriptions TO authenticated;

CREATE TABLE public.web_push_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID NOT NULL UNIQUE REFERENCES public.notifications(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);

CREATE INDEX web_push_outbox_queue_idx
  ON public.web_push_outbox(status, next_attempt_at, created_at);

ALTER TABLE public.web_push_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.web_push_outbox FROM anon, authenticated;
COMMENT ON TABLE public.web_push_outbox IS
  'Service-role-only transactional queue for sending Web Push; no client RLS policies are intentionally defined.';

CREATE OR REPLACE FUNCTION public.enqueue_assigned_message_web_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assigned_agent_id UUID;
BEGIN
  IF NEW.type <> 'incoming_message' OR NEW.conversation_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.assigned_agent_id
    INTO v_assigned_agent_id
  FROM public.conversations c
  WHERE c.id = NEW.conversation_id
    AND c.account_id = NEW.account_id;

  IF v_assigned_agent_id IS DISTINCT FROM NEW.user_id THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.web_push_outbox (notification_id, account_id, user_id, conversation_id)
  VALUES (NEW.id, NEW.account_id, NEW.user_id, NEW.conversation_id)
  ON CONFLICT (notification_id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to enqueue web push for notification %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enqueue_assigned_message_web_push() OWNER TO postgres;

CREATE TRIGGER enqueue_assigned_message_web_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_assigned_message_web_push();
