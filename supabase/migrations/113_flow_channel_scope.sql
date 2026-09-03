-- ============================================================
-- 113 · Flow channel scope
--
-- Flows were reachable only from the native Meta WhatsApp webhook, so a
-- channel filter would have been meaningless. Now that Zernio, Messenger,
-- Instagram and Yeastar Live Chat also run them, a flow needs to say where
-- it applies — a menu written for WhatsApp buttons may not be wanted on a
-- web chat.
--
-- NULL = every channel, which is what every existing flow keeps.
-- ============================================================

ALTER TABLE flows
  ADD COLUMN IF NOT EXISTS channel_types TEXT[];

COMMENT ON COLUMN flows.channel_types IS
  'Inbox channels this flow runs on. NULL = all channels.';

ALTER TABLE flows
  DROP CONSTRAINT IF EXISTS flows_channel_types_check;
ALTER TABLE flows
  ADD CONSTRAINT flows_channel_types_check CHECK (
    channel_types IS NULL
    OR (
      array_length(channel_types, 1) > 0
      AND channel_types <@ ARRAY[
        'whatsapp',
        'zernio_whatsapp',
        'zernio_facebook',
        'zernio_instagram',
        'facebook',
        'instagram',
        'tiktok',
        'yeastar_live_chat'
      ]::TEXT[]
    )
  );
