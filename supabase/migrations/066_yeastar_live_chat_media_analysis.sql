-- Include customer images mirrored from Yeastar Live Chat in the existing
-- media-analysis queue. The worker only reads files from WACRM's chat-media
-- bucket, so this does not allow arbitrary public URLs to be fetched by AI.

CREATE OR REPLACE FUNCTION public.queue_ai_media_analysis_from_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_account_id uuid;
  v_images_enabled boolean;
  v_voice_enabled boolean;
  v_kind text;
  v_is_yeastar_live_chat boolean := false;
BEGIN
  IF NEW.sender_type <> 'customer' OR NEW.media_url IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT account_id INTO v_account_id FROM conversations WHERE id = NEW.conversation_id;
  SELECT EXISTS (
    SELECT 1
    FROM conversations c
    JOIN omnichannel_connectors oc ON oc.id = c.connector_id
    WHERE c.id = NEW.conversation_id
      AND oc.provider = 'yeastar_live_chat'
  ) INTO v_is_yeastar_live_chat;

  -- WhatsApp media stays on its authenticated proxy. Yeastar Live Chat media
  -- has already been mirrored to WACRM Storage by its signed webhook handler.
  IF NEW.media_url !~ '^/api/whatsapp/media/[^/?#]+$'
     AND NOT v_is_yeastar_live_chat THEN
    RETURN NEW;
  END IF;

  SELECT analysis_images_enabled, analysis_voice_notes_enabled
    INTO v_images_enabled, v_voice_enabled
    FROM ai_configs WHERE account_id = v_account_id;

  IF NEW.content_type = 'image' AND COALESCE(v_images_enabled, false) THEN
    v_kind := 'image';
  ELSIF NEW.content_type = 'audio' AND COALESCE(v_voice_enabled, false) THEN
    v_kind := 'voice_note';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO ai_media_analysis_jobs(account_id, conversation_id, message_id, kind)
  VALUES (v_account_id, NEW.conversation_id, NEW.id, v_kind)
  ON CONFLICT (account_id, message_id, kind) DO NOTHING;

  UPDATE messages SET media_analysis_status = 'queued', media_analysis_error = null
    WHERE id = NEW.id;
  RETURN NEW;
END;
$$;
