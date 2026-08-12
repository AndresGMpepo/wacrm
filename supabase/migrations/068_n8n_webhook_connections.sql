-- NexoOmni -> n8n outbound connector metadata.
--
-- Existing `webhook_endpoints` already handles encrypted signing secrets,
-- delivery failure counters and tenant RLS. These two columns only let the
-- dashboard distinguish a managed n8n connection from a generic API webhook.
-- They are additive and safe for all existing customers.

ALTER TABLE public.webhook_endpoints
  ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT 'Webhook',
  ADD COLUMN IF NOT EXISTS integration_type text NOT NULL DEFAULT 'generic';

ALTER TABLE public.webhook_endpoints
  DROP CONSTRAINT IF EXISTS webhook_endpoints_integration_type_check;

ALTER TABLE public.webhook_endpoints
  ADD CONSTRAINT webhook_endpoints_integration_type_check
  CHECK (integration_type IN ('generic', 'n8n'));

CREATE INDEX IF NOT EXISTS webhook_endpoints_account_integration_idx
  ON public.webhook_endpoints (account_id, integration_type, created_at DESC);
