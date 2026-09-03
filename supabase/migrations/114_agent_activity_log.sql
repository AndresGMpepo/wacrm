-- ============================================================
-- 114 · Agent activity log
--
-- Traceability (migration 110) answers "who had this conversation".
-- It does not answer "what did this agent actually do": who closed a
-- chat, who reopened it, who tagged the customer, who took the thread
-- from the AI, who moved a deal.
--
-- Design notes:
--   * Written by triggers, never by the application, so no code path can
--     forget — and so an agent cannot act without leaving a record.
--   * `actor_user_id` is auth.uid(): a signed-in person. NULL means the
--     service role did it (webhook, automation, AI, cron), which is
--     exactly the human-vs-machine distinction performance reporting
--     needs.
--   * Message volume is NOT logged here. `messages` already carries
--     sender_id + created_at, so counting from it is cheaper and exact;
--     duplicating every message into an audit table would double the
--     hottest write path in the product.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.agent_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  -- NULL = done by the system (automation, AI, routing, webhook).
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN (
    'conversation', 'contact', 'deal', 'appointment', 'note', 'tag'
  )),
  entity_id uuid,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_activity_log_account_created_idx
  ON public.agent_activity_log(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_activity_log_actor_idx
  ON public.agent_activity_log(account_id, actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_activity_log_action_idx
  ON public.agent_activity_log(account_id, action, created_at DESC);

ALTER TABLE public.agent_activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_activity_log_admin_select ON public.agent_activity_log;
CREATE POLICY agent_activity_log_admin_select ON public.agent_activity_log
  FOR SELECT USING (is_account_member(account_id, 'admin'));
-- No write policies: only the SECURITY DEFINER triggers below insert.

CREATE OR REPLACE FUNCTION public.log_agent_activity(
  p_account_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_conversation_id uuid,
  p_contact_id uuid,
  p_details jsonb
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO agent_activity_log (
    account_id, actor_user_id, action, entity_type, entity_id,
    conversation_id, contact_id, details
  ) VALUES (
    p_account_id, auth.uid(), p_action, p_entity_type, p_entity_id,
    p_conversation_id, p_contact_id, COALESCE(p_details, '{}'::jsonb)
  );
$$;

ALTER FUNCTION public.log_agent_activity(uuid, text, text, uuid, uuid, uuid, jsonb) OWNER TO postgres;

-- ------------------------------------------------------------
-- Conversations: status, assignment and AI takeover
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.track_conversation_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM log_agent_activity(
      NEW.account_id,
      CASE NEW.status
        WHEN 'closed' THEN 'conversation_closed'
        WHEN 'open' THEN 'conversation_reopened'
        ELSE 'conversation_status_changed'
      END,
      'conversation', NEW.id, NEW.id, NEW.contact_id,
      jsonb_build_object('from', OLD.status, 'to', NEW.status)
    );
  END IF;

  IF NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id THEN
    PERFORM log_agent_activity(
      NEW.account_id,
      CASE WHEN NEW.assigned_agent_id IS NULL THEN 'conversation_released' ELSE 'conversation_assigned' END,
      'conversation', NEW.id, NEW.id, NEW.contact_id,
      jsonb_build_object('from_agent', OLD.assigned_agent_id, 'to_agent', NEW.assigned_agent_id, 'queue', NEW.queue_id)
    );
  END IF;

  IF NEW.ai_autoreply_disabled IS DISTINCT FROM OLD.ai_autoreply_disabled THEN
    PERFORM log_agent_activity(
      NEW.account_id,
      CASE WHEN NEW.ai_autoreply_disabled THEN 'ai_paused' ELSE 'ai_resumed' END,
      'conversation', NEW.id, NEW.id, NEW.contact_id, '{}'::jsonb
    );
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'agent_activity_log (conversation %) failed: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.track_conversation_activity() OWNER TO postgres;
DROP TRIGGER IF EXISTS conversations_activity_log ON public.conversations;
CREATE TRIGGER conversations_activity_log
  AFTER UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.track_conversation_activity();

-- ------------------------------------------------------------
-- Contacts: created, archived, restored
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.track_contact_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM log_agent_activity(NEW.account_id, 'contact_created', 'contact', NEW.id, NULL, NEW.id, '{}'::jsonb);
    RETURN NULL;
  END IF;

  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    PERFORM log_agent_activity(
      NEW.account_id,
      CASE WHEN NEW.deleted_at IS NULL THEN 'contact_restored' ELSE 'contact_archived' END,
      'contact', NEW.id, NULL, NEW.id, '{}'::jsonb
    );
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'agent_activity_log (contact %) failed: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.track_contact_activity() OWNER TO postgres;
DROP TRIGGER IF EXISTS contacts_activity_log ON public.contacts;
CREATE TRIGGER contacts_activity_log
  AFTER INSERT OR UPDATE OF deleted_at ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.track_contact_activity();

-- ------------------------------------------------------------
-- Tags on a contact
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.track_contact_tag_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD := COALESCE(NEW, OLD);
  v_account uuid;
  v_tag text;
BEGIN
  SELECT account_id INTO v_account FROM contacts WHERE id = v_row.contact_id;
  IF v_account IS NULL THEN RETURN NULL; END IF;
  SELECT name INTO v_tag FROM tags WHERE id = v_row.tag_id;

  PERFORM log_agent_activity(
    v_account,
    CASE WHEN TG_OP = 'INSERT' THEN 'tag_added' ELSE 'tag_removed' END,
    'tag', v_row.tag_id, NULL, v_row.contact_id,
    jsonb_build_object('tag', v_tag)
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'agent_activity_log (contact_tag) failed: %', SQLERRM;
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.track_contact_tag_activity() OWNER TO postgres;
DROP TRIGGER IF EXISTS contact_tags_activity_log ON public.contact_tags;
CREATE TRIGGER contact_tags_activity_log
  AFTER INSERT OR DELETE ON public.contact_tags
  FOR EACH ROW EXECUTE FUNCTION public.track_contact_tag_activity();

-- ------------------------------------------------------------
-- Notes on a contact
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.track_contact_note_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid;
BEGIN
  SELECT account_id INTO v_account FROM contacts WHERE id = NEW.contact_id;
  IF v_account IS NULL THEN RETURN NULL; END IF;
  PERFORM log_agent_activity(v_account, 'note_added', 'note', NEW.id, NULL, NEW.contact_id, '{}'::jsonb);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'agent_activity_log (note) failed: %', SQLERRM;
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.track_contact_note_activity() OWNER TO postgres;
DROP TRIGGER IF EXISTS contact_notes_activity_log ON public.contact_notes;
CREATE TRIGGER contact_notes_activity_log
  AFTER INSERT ON public.contact_notes
  FOR EACH ROW EXECUTE FUNCTION public.track_contact_note_activity();

-- ------------------------------------------------------------
-- Deals: created, moved between stages, won/lost
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.track_deal_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM log_agent_activity(
      NEW.account_id, 'deal_created', 'deal', NEW.id, NULL, NEW.contact_id,
      jsonb_build_object('title', NEW.title, 'value', NEW.value)
    );
    RETURN NULL;
  END IF;

  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    SELECT name INTO v_stage FROM pipeline_stages WHERE id = NEW.stage_id;
    PERFORM log_agent_activity(
      NEW.account_id, 'deal_stage_changed', 'deal', NEW.id, NULL, NEW.contact_id,
      jsonb_build_object('stage', v_stage)
    );
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM log_agent_activity(
      NEW.account_id, 'deal_status_changed', 'deal', NEW.id, NULL, NEW.contact_id,
      jsonb_build_object('from', OLD.status, 'to', NEW.status)
    );
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'agent_activity_log (deal %) failed: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.track_deal_activity() OWNER TO postgres;
DROP TRIGGER IF EXISTS deals_activity_log ON public.deals;
CREATE TRIGGER deals_activity_log
  AFTER INSERT OR UPDATE OF stage_id, status ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.track_deal_activity();

-- ------------------------------------------------------------
-- Appointments: created, rescheduled, status changed
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.track_appointment_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM log_agent_activity(
      NEW.account_id, 'appointment_created', 'appointment', NEW.id, NULL, NEW.contact_id,
      jsonb_build_object('title', NEW.title, 'starts_at', NEW.starts_at)
    );
    RETURN NULL;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM log_agent_activity(
      NEW.account_id, 'appointment_status_changed', 'appointment', NEW.id, NULL, NEW.contact_id,
      jsonb_build_object('from', OLD.status, 'to', NEW.status)
    );
  END IF;

  IF NEW.starts_at IS DISTINCT FROM OLD.starts_at THEN
    PERFORM log_agent_activity(
      NEW.account_id, 'appointment_rescheduled', 'appointment', NEW.id, NULL, NEW.contact_id,
      jsonb_build_object('from', OLD.starts_at, 'to', NEW.starts_at)
    );
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'agent_activity_log (appointment %) failed: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.track_appointment_activity() OWNER TO postgres;
DROP TRIGGER IF EXISTS appointments_activity_log ON public.appointments;
CREATE TRIGGER appointments_activity_log
  AFTER INSERT OR UPDATE OF status, starts_at ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.track_appointment_activity();
