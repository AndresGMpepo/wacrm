-- ============================================================
-- 063_yeastar_live_chat_origins.sql
--
-- A Yeastar PBX can expose several Live Chat widgets for one
-- tenant (for example, Sales site and Support portal). Preserve
-- the configured origin on the connector and snapshot it on each
-- conversation so history and reporting remain unambiguous.
-- ============================================================

ALTER TABLE public.omnichannel_connectors
  ADD COLUMN IF NOT EXISTS source_url TEXT
    CHECK (source_url IS NULL OR char_length(source_url) BETWEEN 1 AND 500);

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS channel_source_label TEXT
    CHECK (channel_source_label IS NULL OR char_length(channel_source_label) BETWEEN 1 AND 80),
  ADD COLUMN IF NOT EXISTS channel_source_url TEXT
    CHECK (channel_source_url IS NULL OR char_length(channel_source_url) BETWEEN 1 AND 500);

CREATE INDEX IF NOT EXISTS idx_conversations_account_channel_source
  ON public.conversations(account_id, channel_type, channel_source_label, updated_at DESC);

COMMENT ON COLUMN public.omnichannel_connectors.source_url IS
  'Optional public page or portal where this specific inbound chat widget is installed.';
COMMENT ON COLUMN public.conversations.channel_source_label IS
  'Connector display name captured when the omnichannel conversation was created.';
COMMENT ON COLUMN public.conversations.channel_source_url IS
  'Connector source URL captured when the omnichannel conversation was created.';
