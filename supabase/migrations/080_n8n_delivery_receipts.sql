-- ============================================================
-- 080_n8n_delivery_receipts.sql
--
-- Auditable delivery history for managed NexoOmni -> n8n connections.
-- This deliberately stores metadata only: event name, response status and a
-- short diagnostic. Payloads can contain customer data and stay out of this
-- operational log. Deleting an n8n connection cascades its history so a
-- removed integration no longer remains visible in the account.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.n8n_delivery_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  endpoint_id uuid NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  delivery_id uuid,
  event_type text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('delivered', 'failed', 'test')),
  http_status integer,
  detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS n8n_delivery_receipts_account_created_idx
  ON public.n8n_delivery_receipts (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS n8n_delivery_receipts_endpoint_created_idx
  ON public.n8n_delivery_receipts (endpoint_id, created_at DESC);

ALTER TABLE public.n8n_delivery_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS n8n_delivery_receipts_admin_select ON public.n8n_delivery_receipts;
CREATE POLICY n8n_delivery_receipts_admin_select
  ON public.n8n_delivery_receipts FOR SELECT
  USING (public.is_account_member(account_id, 'admin'));

COMMENT ON TABLE public.n8n_delivery_receipts IS
  'Metadata-only delivery log for managed NexoOmni n8n connections.';
