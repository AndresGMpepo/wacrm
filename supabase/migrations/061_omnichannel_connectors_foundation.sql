-- ============================================================
-- 061_omnichannel_connectors_foundation.sql
--
-- Shared, tenant-safe foundation for messaging channels beyond the
-- existing WhatsApp Cloud integration. The first connector is Yeastar
-- Live Chat; Facebook, Instagram and TikTok will reuse this model.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.omnichannel_connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('yeastar_live_chat', 'facebook', 'instagram', 'tiktok')),
  display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  external_channel_id TEXT NOT NULL CHECK (char_length(external_channel_id) BETWEEN 1 AND 128),
  webhook_secret TEXT,
  status TEXT NOT NULL DEFAULT 'configured' CHECK (status IN ('configured', 'active', 'paused', 'error')),
  last_event_at TIMESTAMPTZ,
  last_error TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, provider, external_channel_id)
);

CREATE INDEX IF NOT EXISTS idx_omnichannel_connectors_account_provider
  ON public.omnichannel_connectors(account_id, provider);

ALTER TABLE public.omnichannel_connectors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS omnichannel_connectors_select ON public.omnichannel_connectors;
DROP POLICY IF EXISTS omnichannel_connectors_insert ON public.omnichannel_connectors;
DROP POLICY IF EXISTS omnichannel_connectors_update ON public.omnichannel_connectors;
DROP POLICY IF EXISTS omnichannel_connectors_delete ON public.omnichannel_connectors;
CREATE POLICY omnichannel_connectors_select ON public.omnichannel_connectors FOR SELECT
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY omnichannel_connectors_insert ON public.omnichannel_connectors FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY omnichannel_connectors_update ON public.omnichannel_connectors FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY omnichannel_connectors_delete ON public.omnichannel_connectors FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS omnichannel_connectors_updated_at ON public.omnichannel_connectors;
CREATE TRIGGER omnichannel_connectors_updated_at
  BEFORE UPDATE ON public.omnichannel_connectors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Existing rows originated from Meta WhatsApp. Future sources keep their
-- own external session identity so the same contact can have separate,
-- traceable conversations by channel without disrupting the WhatsApp flow.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS channel_type TEXT NOT NULL DEFAULT 'whatsapp'
    CHECK (channel_type IN ('whatsapp', 'yeastar_live_chat', 'facebook', 'instagram', 'tiktok')),
  ADD COLUMN IF NOT EXISTS connector_id UUID REFERENCES public.omnichannel_connectors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_conversations_account_channel_updated
  ON public.conversations(account_id, channel_type, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_connector_external_session
  ON public.conversations(account_id, connector_id, external_session_id)
  WHERE connector_id IS NOT NULL AND external_session_id IS NOT NULL;

COMMENT ON COLUMN public.omnichannel_connectors.webhook_secret IS
  'AES-256-GCM encrypted in the WACRM server; never returned to the browser.';
COMMENT ON COLUMN public.conversations.external_session_id IS
  'Provider session/thread identifier. Used for idempotent omnichannel routing.';
