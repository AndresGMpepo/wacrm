-- ============================================================
-- 106 · Automations channel scope
--
-- Automations used to be implicitly WhatsApp-only: the engine was only
-- dispatched from the native Meta WhatsApp webhook. Inbound messages from
-- Zernio (WhatsApp / Facebook / Instagram), native Meta Messenger &
-- Instagram, and Yeastar Live Chat never fired a single trigger.
--
-- `channel_types` scopes an automation to one or more inbox channels.
-- NULL (the default, and what every pre-existing row keeps) means "every
-- channel", so automations built before this migration keep working and
-- immediately extend to the omnichannel inboxes.
-- ============================================================

ALTER TABLE automations
  ADD COLUMN IF NOT EXISTS channel_types TEXT[];

COMMENT ON COLUMN automations.channel_types IS
  'Inbox channels this automation reacts to. NULL = all channels.';

ALTER TABLE automations
  DROP CONSTRAINT IF EXISTS automations_channel_types_check;

ALTER TABLE automations
  ADD CONSTRAINT automations_channel_types_check CHECK (
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
