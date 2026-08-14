-- ============================================================
-- 078_meta_messaging_connectors.sql
--
-- Tenant-scoped credentials for Facebook Messenger and Instagram DMs.
-- Values are AES-256-GCM encrypted by the NexoOmni server before storage;
-- RLS never exposes them to a browser client.
-- ============================================================

ALTER TABLE public.omnichannel_connectors
  ADD COLUMN IF NOT EXISTS meta_access_token TEXT,
  ADD COLUMN IF NOT EXISTS meta_app_secret TEXT,
  ADD COLUMN IF NOT EXISTS meta_verify_token TEXT;

COMMENT ON COLUMN public.omnichannel_connectors.meta_access_token IS
  'AES-256-GCM encrypted Page/Instagram access token. Never returned by the API.';
COMMENT ON COLUMN public.omnichannel_connectors.meta_app_secret IS
  'AES-256-GCM encrypted Meta App Secret used to verify this connector webhook.';
COMMENT ON COLUMN public.omnichannel_connectors.meta_verify_token IS
  'AES-256-GCM encrypted verification token used only during Meta webhook subscription.';

-- Meta message IDs can be significantly longer than Yeastar IDs. The existing
-- receipt table remains the shared idempotency store, so increase this bound
-- before Facebook and Instagram events are acknowledged.
ALTER TABLE public.omnichannel_webhook_receipts
  DROP CONSTRAINT IF EXISTS omnichannel_webhook_receipts_external_message_id_check;
ALTER TABLE public.omnichannel_webhook_receipts
  ADD CONSTRAINT omnichannel_webhook_receipts_external_message_id_check
  CHECK (char_length(external_message_id) BETWEEN 1 AND 512);
