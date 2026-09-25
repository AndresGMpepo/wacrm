-- New tenants get the NexoOmni logo pre-filled instead of a blank
-- avatar — a column DEFAULT covers every account-creation path
-- (signup trigger, add-account RPC, platform-provisioned trigger)
-- without having to touch each INSERT. The client can still overwrite
-- it any time from Settings → Appearance, which just updates this
-- same column.
ALTER TABLE public.accounts
  ALTER COLUMN logo_url SET DEFAULT '/nexoomni-logo.svg';

-- Backfill existing tenants that never customized their logo, so
-- accounts created before this migration also show the brand default
-- instead of nothing.
UPDATE public.accounts SET logo_url = '/nexoomni-logo.svg' WHERE logo_url IS NULL;
