-- ============================================================
-- 133_agendapro_v1_credentials.sql
-- Corrects the AgendaPro integration (132) to target "Agendapro Public V1"
-- (developers.agendapro.com/v1, HTTP Basic Auth) instead of the "Connect v3"
-- (Bearer API key) product 132 was originally built against — this
-- account's real "Configuraciones > API Pública" panel issues a
-- USER + PASSWORD pair, not a single API key, confirmed from a live
-- screenshot. V1 also has no documented webhook signature scheme, no
-- cart/sale concept (a `/payments` record already IS the completed sale),
-- and dedupes webhooks by its own `request_uuid` field instead of a
-- `webhook-id` header.
-- ============================================================

-- agendapro_configs: one USER+PASSWORD pair per tenant instead of one key;
-- no webhook secret to verify against (V1 doesn't sign webhooks at all —
-- the per-account `webhook_token` already in the URL path is the only
-- security boundary, unchanged from 132).
ALTER TABLE public.agendapro_configs
  ADD COLUMN IF NOT EXISTS encrypted_api_user TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_api_password TEXT;

-- No tenant has successfully connected yet under the old Bearer-key flow
-- (this integration shipped and was corrected within the same session), so
-- there is no real credential data to migrate — any existing row's
-- encrypted_api_key is for the wrong API and is simply dropped.
ALTER TABLE public.agendapro_configs
  DROP COLUMN IF EXISTS encrypted_api_key,
  DROP COLUMN IF EXISTS encrypted_webhook_secret;

COMMENT ON TABLE public.agendapro_configs IS
  'Per-tenant AgendaPro V1 Basic-Auth credentials (encrypted). No client RLS policies — service-role only, independent from the Appointments module.';

-- agendapro_bookings: V1 has no "sale" concept to attribute a booking to.
ALTER TABLE public.agendapro_bookings
  DROP COLUMN IF EXISTS sale_id;

-- V1 has no cart/sale concept distinct from a payment — replace both
-- Connect-v3-shaped cache tables with one `agendapro_payments` table
-- matching V1's actual `/payments` resource.
DROP TABLE IF EXISTS public.agendapro_sales;
DROP TABLE IF EXISTS public.agendapro_payment_requests;

CREATE TABLE IF NOT EXISTS public.agendapro_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  agendapro_payment_id TEXT NOT NULL,
  agendapro_client_id TEXT,
  location_id TEXT,
  location_name TEXT,
  amount TEXT,
  paid_amount TEXT,
  payment_date TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, agendapro_payment_id)
);
ALTER TABLE public.agendapro_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY agendapro_payments_member_select ON public.agendapro_payments FOR SELECT USING (is_account_member(account_id));

-- Webhook idempotency key: V1 payloads carry `request_uuid`, not a
-- `webhook-id` header (that was Connect v3's shape).
ALTER TABLE public.agendapro_webhook_receipts
  RENAME COLUMN webhook_id TO request_uuid;
