-- The REST send returns an internal id; the echo also has a distinct Meta id.
-- Existing messages RLS remains unchanged. This writer is service-role-only.
ALTER TABLE public.messages
  ADD COLUMN zernio_internal_message_id text,
  ADD COLUMN zernio_local_origin boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX messages_zernio_internal_unique
  ON public.messages(conversation_id, zernio_internal_message_id)
  WHERE zernio_internal_message_id IS NOT NULL;

CREATE FUNCTION public.persist_zernio_outbound_message(
  p_account_id uuid, p_connector_id uuid, p_conversation_id uuid,
  p_internal_id text, p_platform_id text, p_local boolean,
  p_message jsonb, p_fallback_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  current_row public.messages;
  duplicate_row public.messages;
  canonical_id text;
  matching_ids uuid[];
  keep_local boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations c
    JOIN public.omnichannel_connectors o ON o.id = c.connector_id
    WHERE c.id = p_conversation_id AND c.account_id = p_account_id
      AND o.id = p_connector_id AND o.account_id = p_account_id
      AND c.channel_type LIKE 'zernio_%'
  ) THEN
    RAISE EXCEPTION 'Conversation does not belong to this account and connector';
  END IF;
  IF p_fallback_id IS NULL OR p_fallback_id = '' THEN
    RAISE EXCEPTION 'Missing outbound message identity';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_conversation_id::text, 138));
  canonical_id := 'zernio:out:' || p_connector_id || ':' ||
    coalesce(nullif(p_internal_id, ''), nullif(p_platform_id, ''), p_fallback_id);

  SELECT array_agg(m.id ORDER BY m.zernio_local_origin DESC,
    m.ai_generated DESC, (m.sender_type = 'bot') DESC, m.created_at, m.id)
  INTO matching_ids
  FROM public.messages m
  WHERE m.conversation_id = p_conversation_id AND m.sender_type <> 'customer'
    AND (
      m.zernio_internal_message_id = p_internal_id
      OR m.platform_message_id IN (p_internal_id, p_platform_id)
      OR m.message_id = canonical_id
      OR m.message_id = 'zernio:out:' || p_connector_id || ':' || p_platform_id
    );

  IF matching_ids IS NOT NULL THEN
    SELECT * INTO current_row FROM public.messages WHERE id = matching_ids[1];
    -- Exact provider identities only, never text/time similarity. Preserve
    -- reply, flow, reaction and analysis references before removing echoes.
    FOR duplicate_row IN SELECT * FROM public.messages
      WHERE id = ANY(matching_ids) AND id <> current_row.id
    LOOP
      UPDATE public.messages SET reply_to_message_id = current_row.id
        WHERE reply_to_message_id = duplicate_row.id;
      UPDATE public.flow_runs SET last_prompt_message_id = current_row.id
        WHERE last_prompt_message_id = duplicate_row.id;
      DELETE FROM public.message_reactions r
        WHERE r.message_id = duplicate_row.id AND EXISTS (
          SELECT 1 FROM public.message_reactions k WHERE k.message_id = current_row.id
            AND k.actor_type = r.actor_type AND k.actor_id IS NOT DISTINCT FROM r.actor_id
        );
      UPDATE public.message_reactions SET message_id = current_row.id
        WHERE message_id = duplicate_row.id;
      DELETE FROM public.ai_media_analysis_jobs j
        WHERE j.message_id = duplicate_row.id AND EXISTS (
          SELECT 1 FROM public.ai_media_analysis_jobs k WHERE k.message_id = current_row.id
            AND k.account_id = j.account_id AND k.kind = j.kind
        );
      UPDATE public.ai_media_analysis_jobs SET message_id = current_row.id
        WHERE message_id = duplicate_row.id;
      DELETE FROM public.messages WHERE id = duplicate_row.id;
    END LOOP;

    keep_local := current_row.zernio_local_origin OR current_row.ai_generated
      OR current_row.sender_type = 'bot';
    UPDATE public.messages SET
      zernio_internal_message_id = coalesce(p_internal_id, zernio_internal_message_id),
      zernio_local_origin = p_local OR keep_local,
      message_id = canonical_id,
      platform_message_id = coalesce(p_platform_id, platform_message_id, p_internal_id),
      sender_type = CASE WHEN p_local OR NOT keep_local THEN p_message->>'sender_type' ELSE sender_type END,
      sender_id = CASE WHEN p_local OR NOT keep_local THEN (p_message->>'sender_id')::uuid ELSE sender_id END,
      content_type = CASE WHEN p_local THEN p_message->>'content_type' ELSE content_type END,
      content_text = CASE WHEN p_local THEN p_message->>'content_text' ELSE content_text END,
      media_url = CASE WHEN p_local THEN p_message->>'media_url' ELSE media_url END,
      template_name = CASE WHEN p_local THEN p_message->>'template_name' ELSE template_name END,
      ai_generated = CASE WHEN p_local THEN coalesce((p_message->>'ai_generated')::boolean, false) ELSE ai_generated END
    WHERE id = current_row.id RETURNING * INTO current_row;
  ELSE
    INSERT INTO public.messages (
      conversation_id, sender_type, sender_id, content_type, content_text,
      media_url, template_name, message_id, platform_message_id,
      zernio_internal_message_id, zernio_local_origin, ai_generated, status, created_at
    ) VALUES (
      p_conversation_id, p_message->>'sender_type', (p_message->>'sender_id')::uuid,
      p_message->>'content_type', p_message->>'content_text', p_message->>'media_url',
      p_message->>'template_name', canonical_id, coalesce(p_platform_id, p_internal_id),
      p_internal_id, p_local, coalesce((p_message->>'ai_generated')::boolean, false),
      'sent', (p_message->>'created_at')::timestamptz
    ) RETURNING * INTO current_row;
  END IF;
  RETURN to_jsonb(current_row);
END;
$$;

REVOKE ALL ON FUNCTION public.persist_zernio_outbound_message(uuid, uuid, uuid, text, text, boolean, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_zernio_outbound_message(uuid, uuid, uuid, text, text, boolean, jsonb, text)
  TO service_role;

-- Repair prior duplicates/false human attribution only when a stored receipt
-- proves the two ids and the API lineage. Unknown lineage is not guessed.
-- Old operator sends used the internal id for both local identity fields.
-- Preserve these conservatively unless a bot row proves it was an AI echo.
UPDATE public.messages m SET zernio_local_origin = true
FROM public.zernio_webhook_receipts w, public.conversations c
WHERE c.id = m.conversation_id AND c.account_id = w.account_id
  AND c.connector_id = w.connector_id AND w.event_type = 'message.sent'
  AND w.payload->'message'->>'sentVia' = 'api'
  AND m.sender_type = 'agent' AND m.sender_id IS NOT NULL
  AND m.platform_message_id = w.payload->'message'->>'id'
  AND m.message_id = 'zernio:out:' || w.connector_id || ':' || (w.payload->'message'->>'id')
  AND NOT EXISTS (
    SELECT 1 FROM public.messages b WHERE b.conversation_id = c.id
      AND (b.sender_type = 'bot' OR b.ai_generated)
      AND b.platform_message_id IN (w.payload->'message'->>'id', w.payload->'message'->>'platformMessageId')
  );

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT w.account_id, w.connector_id, w.payload->'message' AS msg, c.id AS conversation_id
    FROM public.zernio_webhook_receipts w
    JOIN public.conversations c ON c.account_id = w.account_id
      AND c.connector_id = w.connector_id
      AND c.external_session_id = coalesce(w.payload->'conversation'->>'id', w.payload->'message'->>'conversationId')
    WHERE w.event_type = 'message.sent'
      AND w.payload->'message'->>'sentVia' = 'api'
      AND nullif(w.payload->'message'->>'id', '') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.messages m WHERE m.conversation_id = c.id
          AND m.sender_type <> 'customer'
          AND m.platform_message_id IN (w.payload->'message'->>'id', w.payload->'message'->>'platformMessageId')
      )
  LOOP
    PERFORM public.persist_zernio_outbound_message(
      r.account_id, r.connector_id, r.conversation_id, r.msg->>'id',
      r.msg->>'platformMessageId', false,
      jsonb_build_object('sender_type', 'bot', 'sender_id', null,
        'content_type', 'text', 'content_text', r.msg->>'text',
        'created_at', r.msg->>'sentAt'),
      r.msg->>'id'
    );
  END LOOP;
END;
$$;
