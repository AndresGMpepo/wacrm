-- Executive reporting foundation.
-- This is additive: it introduces the account's operating lens and the
-- indexes used by the read-only reporting API. No customer data is moved,
-- changed, or exposed by this migration.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS operating_mode text NOT NULL DEFAULT 'hybrid';

ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_operating_mode_check;

ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_operating_mode_check
  CHECK (operating_mode IN ('commercial', 'support', 'hybrid'));

COMMENT ON COLUMN public.accounts.operating_mode IS
  'Executive reporting lens chosen by account admins: commercial, support, or hybrid.';

CREATE INDEX IF NOT EXISTS idx_conversations_account_created
  ON public.conversations(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_account_status_updated
  ON public.conversations(account_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON public.messages(conversation_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_deals_account_status_updated
  ON public.deals(account_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_broadcasts_account_created
  ON public.broadcasts(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_conversation_analyses_account_analyzed
  ON public.ai_conversation_analyses(account_id, analyzed_at DESC)
  WHERE status = 'completed';
