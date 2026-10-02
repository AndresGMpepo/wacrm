-- ============================================================
-- 132_agendapro_integration.sql
-- AgendaPro (developers.agendapro.com) integration — independent of the
-- existing Appointments module (specialists/google_calendar_connections/
-- appointments) by explicit product decision. One AgendaPro API key per
-- tenant, pasted in Settings (NOT a shared env-var key like Zernio's).
--
-- NOTE: this is the ORIGINAL, ALREADY-APPLIED version of this migration —
-- it targeted "Connect v3" (Bearer API key), which turned out to be the
-- WRONG AgendaPro API generation for this account (it actually uses
-- "Agendapro Public V1", HTTP Basic Auth). Per the never-edit-an-applied-
-- migration rule, this file is restored to what actually ran; the
-- correction to V1's real shape lives in 133_agendapro_v1_credentials.sql.
-- ============================================================

ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_enabled_modules_check;
ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_enabled_modules_check
  CHECK (enabled_modules <@ ARRAY['pipelines', 'appointments', 'agendapro']::TEXT[]);

-- Per-tenant connector config. Secrets are encrypted by the application
-- (src/lib/whatsapp/encryption.ts, shared cipher) before they reach this
-- table — mirrors telephony_configs (037): RLS enabled, zero client
-- policies, read only by server Route Handlers via the service role after
-- an app-level role check.
CREATE TABLE IF NOT EXISTS public.agendapro_configs (
  account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  encrypted_api_key TEXT NOT NULL,
  encrypted_webhook_secret TEXT,
  -- Random public identifier used in the webhook URL path. AgendaPro's
  -- webhook payload carries no account/company identifier we control, so
  -- routing an inbound webhook to the right tenant has to come from the
  -- URL itself (mirrors Yeastar's [connectorId]/[accountId]-scoped routes).
  -- Deliberately NOT the account_id, to avoid leaking it publicly.
  webhook_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'configured' CHECK (status IN ('configured', 'active', 'error')),
  last_error TEXT,
  connected_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.agendapro_configs ENABLE ROW LEVEL SECURITY;

-- Maps AgendaPro's own client id to our contact_id (resolved via the
-- existing phone/email dedupe in src/lib/contacts/dedupe.ts).
CREATE TABLE IF NOT EXISTS public.agendapro_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  agendapro_client_id TEXT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, agendapro_client_id)
);
ALTER TABLE public.agendapro_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY agendapro_clients_member_select ON public.agendapro_clients FOR SELECT USING (is_account_member(account_id));

CREATE TABLE IF NOT EXISTS public.agendapro_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  agendapro_booking_id TEXT NOT NULL,
  agendapro_client_id TEXT,
  service_name TEXT,
  provider_name TEXT,
  location_id TEXT,
  location_name TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  status_id INTEGER,
  status_name TEXT,
  price TEXT,
  sale_id TEXT,
  agendapro_created_at TIMESTAMPTZ,
  agendapro_updated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, agendapro_booking_id)
);
ALTER TABLE public.agendapro_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY agendapro_bookings_member_select ON public.agendapro_bookings FOR SELECT USING (is_account_member(account_id));
CREATE INDEX IF NOT EXISTS idx_agendapro_bookings_contact ON public.agendapro_bookings(contact_id);

CREATE TABLE IF NOT EXISTS public.agendapro_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  agendapro_sale_id TEXT NOT NULL,
  status TEXT,
  cart_id TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, agendapro_sale_id)
);
ALTER TABLE public.agendapro_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY agendapro_sales_member_select ON public.agendapro_sales FOR SELECT USING (is_account_member(account_id));

CREATE TABLE IF NOT EXISTS public.agendapro_payment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  agendapro_payment_request_id TEXT NOT NULL,
  status TEXT,
  amount TEXT,
  payment_url TEXT,
  agendapro_created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, agendapro_payment_request_id)
);
ALTER TABLE public.agendapro_payment_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY agendapro_payment_requests_member_select ON public.agendapro_payment_requests FOR SELECT USING (is_account_member(account_id));

-- Webhook idempotency, keyed by AgendaPro's stable `webhook-id` header
-- (stays the same across their own retries) — mirrors zernio_webhook_receipts.
CREATE TABLE IF NOT EXISTS public.agendapro_webhook_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  webhook_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'processing' CHECK (outcome IN ('processing', 'processed', 'ignored', 'failed')),
  detail TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE(account_id, webhook_id)
);
ALTER TABLE public.agendapro_webhook_receipts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.agendapro_configs IS
  'Per-tenant AgendaPro API key + webhook secret (encrypted). No client RLS policies — service-role only, independent from the Appointments module.';

