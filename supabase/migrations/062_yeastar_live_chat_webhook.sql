-- ============================================================
-- 062_yeastar_live_chat_webhook.sql
--
-- Idempotency, contact identity and diagnostics for Yeastar Event
-- 30031. These tables never expose provider secrets or raw payloads
-- to browser clients.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.omnichannel_contact_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  connector_id UUID NOT NULL REFERENCES public.omnichannel_connectors(id) ON DELETE CASCADE,
  external_user_id TEXT NOT NULL CHECK (char_length(external_user_id) BETWEEN 1 AND 256),
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(connector_id, external_user_id)
);

CREATE INDEX IF NOT EXISTS idx_omnichannel_contact_identities_account_contact
  ON public.omnichannel_contact_identities(account_id, contact_id);

ALTER TABLE public.omnichannel_contact_identities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS omnichannel_contact_identities_select ON public.omnichannel_contact_identities;
CREATE POLICY omnichannel_contact_identities_select ON public.omnichannel_contact_identities FOR SELECT
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS omnichannel_contact_identities_updated_at ON public.omnichannel_contact_identities;
CREATE TRIGGER omnichannel_contact_identities_updated_at
  BEFORE UPDATE ON public.omnichannel_contact_identities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.omnichannel_webhook_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  connector_id UUID NOT NULL REFERENCES public.omnichannel_connectors(id) ON DELETE CASCADE,
  event_type INTEGER NOT NULL,
  external_message_id TEXT NOT NULL CHECK (char_length(external_message_id) BETWEEN 1 AND 256),
  outcome TEXT NOT NULL CHECK (outcome IN ('processing', 'processed', 'ignored', 'failed')),
  detail TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE(connector_id, event_type, external_message_id)
);

CREATE INDEX IF NOT EXISTS idx_omnichannel_webhook_receipts_connector_received
  ON public.omnichannel_webhook_receipts(connector_id, received_at DESC);

ALTER TABLE public.omnichannel_webhook_receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS omnichannel_webhook_receipts_admin_select ON public.omnichannel_webhook_receipts;
CREATE POLICY omnichannel_webhook_receipts_admin_select ON public.omnichannel_webhook_receipts FOR SELECT
  USING (is_account_member(account_id, 'admin'));
