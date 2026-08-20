-- ============================================================
-- 083_zernio_guided_connections.sql
-- Tenant-scoped connection state for the NexoOmni guided channels.
-- API keys stay in the application environment, never in Postgres/browser.
-- ============================================================

ALTER TABLE public.omnichannel_connectors
  DROP CONSTRAINT IF EXISTS omnichannel_connectors_provider_check;
ALTER TABLE public.omnichannel_connectors
  ADD CONSTRAINT omnichannel_connectors_provider_check
  CHECK (provider IN ('yeastar_live_chat', 'facebook', 'instagram', 'tiktok', 'zernio_whatsapp', 'zernio_facebook', 'zernio_instagram'));

ALTER TABLE public.omnichannel_connectors
  ADD COLUMN IF NOT EXISTS zernio_profile_id TEXT,
  ADD COLUMN IF NOT EXISTS zernio_account_id TEXT,
  ADD COLUMN IF NOT EXISTS zernio_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.zernio_profiles (
  account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL UNIQUE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.zernio_connection_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'facebook', 'instagram')),
  state UUID NOT NULL UNIQUE,
  zernio_profile_id TEXT NOT NULL,
  known_account_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  redirect_uri TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_zernio_connection_attempts_expiry
  ON public.zernio_connection_attempts(expires_at);

ALTER TABLE public.zernio_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zernio_connection_attempts ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN public.omnichannel_connectors.zernio_account_id IS
  'External Zernio account id. No Zernio API secret is stored in Postgres.';

ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_channel_type_check;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_channel_type_check
  CHECK (channel_type IN (
    'whatsapp', 'yeastar_live_chat', 'facebook', 'instagram', 'tiktok',
    'zernio_whatsapp', 'zernio_facebook', 'zernio_instagram'
  ));

CREATE TABLE IF NOT EXISTS public.zernio_webhook_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  connector_id UUID NOT NULL REFERENCES public.omnichannel_connectors(id) ON DELETE CASCADE,
  external_message_id TEXT,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'processing' CHECK (outcome IN ('processing', 'processed', 'ignored', 'failed')),
  detail TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_zernio_webhook_receipts_dedupe
  ON public.zernio_webhook_receipts(connector_id, external_message_id)
  WHERE external_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_zernio_webhook_receipts_account_received
  ON public.zernio_webhook_receipts(account_id, received_at DESC);
ALTER TABLE public.zernio_webhook_receipts ENABLE ROW LEVEL SECURITY;
