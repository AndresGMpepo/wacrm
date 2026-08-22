-- The operating objective describes the business focus. Enabled modules are
-- independent capabilities, so a clinic may still keep its sales pipeline.
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS enabled_modules TEXT[] NOT NULL DEFAULT ARRAY['pipelines']::TEXT[];

ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_operating_mode_check;

ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_operating_mode_check
  CHECK (operating_mode IN ('commercial', 'support', 'services', 'hybrid'));

ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_enabled_modules_check;

ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_enabled_modules_check
  CHECK (enabled_modules <@ ARRAY['pipelines', 'appointments']::TEXT[]);

COMMENT ON COLUMN public.accounts.enabled_modules IS
  'Account-selected product modules. The operating objective remains independent from enabled capabilities.';