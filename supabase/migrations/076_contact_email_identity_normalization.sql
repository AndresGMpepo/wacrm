-- ============================================================
-- 076_contact_email_identity_normalization.sql
--
-- Exact, account-scoped email identity for omnichannel contacts.
-- This is intentionally not unique: historical CRM data may legitimately
-- contain repeated emails. Webhooks only link an incoming chat when there is
-- exactly one matching contact, never choosing a duplicate arbitrarily.
-- ============================================================

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS email_normalized TEXT
  GENERATED ALWAYS AS (NULLIF(lower(btrim(email)), '')) STORED;

CREATE INDEX IF NOT EXISTS idx_contacts_account_email_normalized
  ON public.contacts (account_id, email_normalized)
  WHERE email_normalized IS NOT NULL;

COMMENT ON COLUMN public.contacts.email_normalized IS
  'Read-only normalized email used for exact, account-scoped omnichannel identity matching.';
