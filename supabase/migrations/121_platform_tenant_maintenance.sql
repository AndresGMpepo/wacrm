-- ============================================================
-- Platform-operator tenant maintenance:
--   1) wipe_tenant_operational_data(account_id) — one-off "reset for
--      production" button. Deletes CRM/operational data (contacts,
--      conversations, messages, deals, broadcasts, appointments,
--      notifications, AI analysis/runs) but deliberately KEEPS
--      configuration: the account/subscription/members themselves,
--      WhatsApp/Zernio/Yeastar connections, approved message
--      templates, and automation/flow DEFINITIONS (only their run
--      history is cleared).
--   2) platform_settings + purge_old_messages() — a global message
--      retention policy. Only ever touched by the service role (the
--      platform-operator API routes / the internal cron worker), never
--      exposed to tenant admins.
-- Both functions are SECURITY DEFINER and revoked from anon/authenticated
-- — callers must go through a service-role client, matching the existing
-- platform_commercial_audit / merge_contacts pattern.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.platform_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  message_retention_days integer CHECK (message_retention_days IS NULL OR message_retention_days >= 30),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.platform_settings (id, message_retention_days) VALUES (true, NULL) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: this table is only ever touched via a
-- service-role client (platform API routes + the internal cron), never
-- by a regular authenticated tenant session.
REVOKE ALL ON public.platform_settings FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.wipe_tenant_operational_data(p_account_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_messages int; v_conversations int; v_contacts int; v_deals int;
  v_broadcasts int; v_appointments int; v_notifications int;
BEGIN
  IF p_account_id IS NULL THEN RAISE EXCEPTION 'p_account_id is required'; END IF;

  -- Children of conversations/messages first.
  DELETE FROM public.ai_media_analysis_jobs WHERE message_id IN (
    SELECT m.id FROM public.messages m JOIN public.conversations c ON c.id = m.conversation_id WHERE c.account_id = p_account_id);
  DELETE FROM public.message_reactions WHERE message_id IN (
    SELECT m.id FROM public.messages m JOIN public.conversations c ON c.id = m.conversation_id WHERE c.account_id = p_account_id);
  DELETE FROM public.conversation_internal_note_reads WHERE conversation_id IN (SELECT id FROM public.conversations WHERE account_id = p_account_id);
  DELETE FROM public.conversation_internal_notes WHERE conversation_id IN (SELECT id FROM public.conversations WHERE account_id = p_account_id);
  DELETE FROM public.conversation_assignment_history WHERE conversation_id IN (SELECT id FROM public.conversations WHERE account_id = p_account_id);

  -- AI run history (NOT ai_configs — that's tenant configuration).
  DELETE FROM public.ai_analysis_jobs WHERE account_id = p_account_id;
  DELETE FROM public.ai_conversation_analyses WHERE account_id = p_account_id;
  DELETE FROM public.ai_usage_log WHERE account_id = p_account_id;

  -- Flow/automation RUN history (NOT flows/automations definitions).
  DELETE FROM public.flow_run_events WHERE flow_run_id IN (SELECT id FROM public.flow_runs WHERE account_id = p_account_id);
  DELETE FROM public.flow_runs WHERE account_id = p_account_id;
  DELETE FROM public.automation_pending_executions WHERE account_id = p_account_id;
  DELETE FROM public.automation_logs WHERE account_id = p_account_id;

  -- Broadcasts.
  DELETE FROM public.broadcast_recipients WHERE broadcast_id IN (SELECT id FROM public.broadcasts WHERE account_id = p_account_id);
  DELETE FROM public.broadcasts WHERE account_id = p_account_id;
  GET DIAGNOSTICS v_broadcasts = ROW_COUNT;

  -- Messages + conversations.
  DELETE FROM public.messages WHERE conversation_id IN (SELECT id FROM public.conversations WHERE account_id = p_account_id);
  GET DIAGNOSTICS v_messages = ROW_COUNT;
  DELETE FROM public.conversations WHERE account_id = p_account_id;
  GET DIAGNOSTICS v_conversations = ROW_COUNT;

  -- Appointments.
  DELETE FROM public.appointment_reminders WHERE appointment_id IN (SELECT id FROM public.appointments WHERE account_id = p_account_id);
  DELETE FROM public.appointment_audit_log WHERE appointment_id IN (SELECT id FROM public.appointments WHERE account_id = p_account_id);
  DELETE FROM public.appointments WHERE account_id = p_account_id;
  GET DIAGNOSTICS v_appointments = ROW_COUNT;

  -- Deals (before contacts — deals.contact_id has no ON DELETE CASCADE).
  DELETE FROM public.deals WHERE account_id = p_account_id;
  GET DIAGNOSTICS v_deals = ROW_COUNT;

  -- Nexo Memory + contact-scoped children, then contacts themselves
  -- (contact_tags/contact_custom_values/contact_notes/omnichannel_contact_identities
  -- cascade automatically via their own contact_id FK).
  DELETE FROM public.contact_memory_events WHERE contact_id IN (SELECT id FROM public.contacts WHERE account_id = p_account_id);
  DELETE FROM public.contact_facts WHERE contact_id IN (SELECT id FROM public.contacts WHERE account_id = p_account_id);
  DELETE FROM public.contact_commitments WHERE contact_id IN (SELECT id FROM public.contacts WHERE account_id = p_account_id);
  DELETE FROM public.contact_memory WHERE contact_id IN (SELECT id FROM public.contacts WHERE account_id = p_account_id);
  DELETE FROM public.contacts WHERE account_id = p_account_id;
  GET DIAGNOSTICS v_contacts = ROW_COUNT;

  -- Voice/call test data.
  DELETE FROM public.call_follow_up_tasks WHERE account_id = p_account_id;
  DELETE FROM public.yeastar_call_transcriptions WHERE account_id = p_account_id;
  DELETE FROM public.yeastar_live_calls WHERE account_id = p_account_id;

  -- Notifications.
  DELETE FROM public.notifications WHERE account_id = p_account_id;
  GET DIAGNOSTICS v_notifications = ROW_COUNT;

  RETURN jsonb_build_object(
    'contacts', v_contacts, 'conversations', v_conversations, 'messages', v_messages,
    'deals', v_deals, 'broadcasts', v_broadcasts, 'appointments', v_appointments,
    'notifications', v_notifications
  );
END;
$$;
REVOKE ALL ON FUNCTION public.wipe_tenant_operational_data(uuid) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.purge_old_messages()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days int;
  v_cutoff timestamptz;
  v_deleted int;
BEGIN
  SELECT message_retention_days INTO v_days FROM public.platform_settings WHERE id = true;
  IF v_days IS NULL THEN
    RETURN jsonb_build_object('enabled', false, 'deleted', 0);
  END IF;
  v_cutoff := now() - (v_days || ' days')::interval;
  DELETE FROM public.messages WHERE created_at < v_cutoff;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN jsonb_build_object('enabled', true, 'retention_days', v_days, 'cutoff', v_cutoff, 'deleted', v_deleted);
END;
$$;
REVOKE ALL ON FUNCTION public.purge_old_messages() FROM anon, authenticated;
