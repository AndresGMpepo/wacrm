-- ============================================================
-- 107 · AI agent channel scope + handoff routing
--
-- Two gaps the AI agent had:
--   1. It only ran on the native Meta WhatsApp webhook and had no way to
--      be limited to (or extended to) specific inbox channels.
--   2. Handoff could only target one fixed agent. Accounts that route by
--      department need the conversation to land in a queue — either a
--      fixed one, or the one the model itself picks from the chat.
--
-- `channel_types` NULL = every channel (what every existing row keeps).
-- `handoff_target` defaults to 'agent', which reproduces today's
-- behaviour exactly: assign to handoff_agent_id when set, otherwise
-- leave the conversation unassigned.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS channel_types TEXT[],
  ADD COLUMN IF NOT EXISTS handoff_queue_id uuid REFERENCES public.conversation_queues(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS handoff_target TEXT NOT NULL DEFAULT 'agent';

COMMENT ON COLUMN ai_configs.channel_types IS
  'Inbox channels the AI agent answers on. NULL = all channels.';
COMMENT ON COLUMN ai_configs.handoff_target IS
  'unassigned | agent (handoff_agent_id) | queue (handoff_queue_id) | ai_queue (model picks the queue).';

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_handoff_target_check;
ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_handoff_target_check
    CHECK (handoff_target IN ('unassigned', 'agent', 'queue', 'ai_queue'));

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_channel_types_check;
ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_channel_types_check CHECK (
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
