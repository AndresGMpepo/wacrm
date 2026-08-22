-- ============================================================
-- 088_merge_contacts.sql
--
-- Manual "merge duplicate contacts" capability. Some channels
-- (native Facebook/Instagram Messenger) never expose the customer's
-- phone or email, so the same person messaging via WhatsApp and via
-- Messenger unavoidably creates two separate contact rows — there is
-- no validated field to auto-link them. This lets an admin/agent who
-- recognizes the duplicate fold one contact into the other, moving
-- every related record (conversations, messages, deals, notes, tags,
-- analyses, etc.) instead of losing history.
--
-- Prerequisite fix: conversations previously enforced "one conversation
-- per (account, contact)" ever (migration 036), which assumed a
-- contact only ever has a single channel. A merged contact legitimately
-- has one conversation PER CHANNEL (e.g. one WhatsApp thread + one
-- Facebook thread), so the uniqueness is widened to include
-- channel_type. The native WhatsApp find-or-create paths
-- (src/app/api/whatsapp/webhook/route.ts,
-- src/lib/whatsapp/resolve-conversation.ts) were updated in the same
-- change to filter/insert channel_type = 'whatsapp' explicitly, so they
-- keep resolving to the right thread once a contact can have more than
-- one.
-- ============================================================

DROP INDEX IF EXISTS idx_conversations_account_contact;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_channel
  ON conversations (account_id, contact_id, channel_type);

CREATE OR REPLACE FUNCTION public.merge_contacts(
  p_account_id UUID,
  p_survivor_id UUID,
  p_loser_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_survivor contacts%ROWTYPE;
  v_loser contacts%ROWTYPE;
  v_conv RECORD;
  v_existing_conv UUID;
BEGIN
  IF p_survivor_id = p_loser_id THEN
    RAISE EXCEPTION 'No se puede fusionar un contacto consigo mismo.';
  END IF;

  SELECT * INTO v_survivor FROM contacts WHERE id = p_survivor_id AND account_id = p_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contacto destino no encontrado.'; END IF;

  SELECT * INTO v_loser FROM contacts WHERE id = p_loser_id AND account_id = p_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contacto a fusionar no encontrado.'; END IF;

  -- Backfill identity fields the survivor is missing, from the loser.
  UPDATE contacts SET
    name = CASE WHEN name IS NULL OR btrim(name) = '' THEN v_loser.name ELSE name END,
    email = CASE WHEN email IS NULL OR btrim(email) = '' THEN v_loser.email ELSE email END,
    company = CASE WHEN company IS NULL OR btrim(company) = '' THEN v_loser.company ELSE company END,
    avatar_url = CASE WHEN avatar_url IS NULL OR btrim(avatar_url) = '' THEN v_loser.avatar_url ELSE avatar_url END,
    updated_at = now()
  WHERE id = p_survivor_id;

  -- Conversations: one per (account, contact, channel_type). If the
  -- survivor already has a thread on that channel, fold the loser's
  -- conversation into it instead of re-pointing (which would violate
  -- the unique index); otherwise a plain re-point is enough.
  FOR v_conv IN
    SELECT id, channel_type FROM conversations
    WHERE account_id = p_account_id AND contact_id = p_loser_id
  LOOP
    SELECT id INTO v_existing_conv FROM conversations
      WHERE account_id = p_account_id AND contact_id = p_survivor_id AND channel_type = v_conv.channel_type;

    IF v_existing_conv IS NULL THEN
      UPDATE conversations SET contact_id = p_survivor_id, updated_at = now() WHERE id = v_conv.id;
    ELSE
      UPDATE messages                   SET conversation_id = v_existing_conv WHERE conversation_id = v_conv.id;
      UPDATE message_reactions          SET conversation_id = v_existing_conv WHERE conversation_id = v_conv.id;
      UPDATE deals                      SET conversation_id = v_existing_conv WHERE conversation_id = v_conv.id;
      UPDATE flow_runs                  SET conversation_id = v_existing_conv WHERE conversation_id = v_conv.id;
      UPDATE notifications              SET conversation_id = v_existing_conv WHERE conversation_id = v_conv.id;
      UPDATE ai_usage_log               SET conversation_id = v_existing_conv WHERE conversation_id = v_conv.id;
      UPDATE conversation_internal_notes SET conversation_id = v_existing_conv WHERE conversation_id = v_conv.id;

      -- ai_conversation_analyses has UNIQUE(conversation_id, source);
      -- keep the survivor's existing analysis on conflict.
      UPDATE ai_conversation_analyses a SET conversation_id = v_existing_conv
        WHERE a.conversation_id = v_conv.id
          AND NOT EXISTS (
            SELECT 1 FROM ai_conversation_analyses s
            WHERE s.conversation_id = v_existing_conv AND s.source = a.source
          );
      DELETE FROM ai_conversation_analyses WHERE conversation_id = v_conv.id;

      UPDATE conversations c SET
        unread_count = c.unread_count + COALESCE((SELECT unread_count FROM conversations WHERE id = v_conv.id), 0),
        updated_at = now()
      WHERE c.id = v_existing_conv;

      DELETE FROM conversations WHERE id = v_conv.id;
    END IF;
  END LOOP;

  -- Guarded re-points: UNIQUE(contact_id, tag_id) / (contact_id, custom_field_id).
  UPDATE contact_tags ct SET contact_id = p_survivor_id
    WHERE ct.contact_id = p_loser_id
      AND NOT EXISTS (SELECT 1 FROM contact_tags s WHERE s.contact_id = p_survivor_id AND s.tag_id = ct.tag_id);
  DELETE FROM contact_tags WHERE contact_id = p_loser_id;

  UPDATE contact_custom_values cv SET contact_id = p_survivor_id
    WHERE cv.contact_id = p_loser_id
      AND NOT EXISTS (SELECT 1 FROM contact_custom_values s WHERE s.contact_id = p_survivor_id AND s.custom_field_id = cv.custom_field_id);
  DELETE FROM contact_custom_values WHERE contact_id = p_loser_id;

  -- flow_runs: only non-active (a partial unique index guards 'active').
  UPDATE flow_runs SET contact_id = p_survivor_id
    WHERE contact_id = p_loser_id AND status <> 'active';

  -- Plain re-points — no contact-scoped unique constraint on these.
  UPDATE contact_notes                  SET contact_id = p_survivor_id WHERE contact_id = p_loser_id;
  UPDATE deals                          SET contact_id = p_survivor_id WHERE contact_id = p_loser_id;
  UPDATE broadcast_recipients           SET contact_id = p_survivor_id WHERE contact_id = p_loser_id;
  UPDATE automation_logs                SET contact_id = p_survivor_id WHERE contact_id = p_loser_id;
  UPDATE automation_pending_executions  SET contact_id = p_survivor_id WHERE contact_id = p_loser_id;
  UPDATE notifications                  SET contact_id = p_survivor_id WHERE contact_id = p_loser_id;
  UPDATE yeastar_call_transcriptions    SET contact_id = p_survivor_id WHERE contact_id = p_loser_id;
  UPDATE omnichannel_contact_identities SET contact_id = p_survivor_id WHERE contact_id = p_loser_id;

  DELETE FROM contacts WHERE id = p_loser_id AND account_id = p_account_id;

  RETURN p_survivor_id;
END;
$$;

ALTER FUNCTION public.merge_contacts(UUID, UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.merge_contacts(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_contacts(UUID, UUID, UUID) TO service_role;
