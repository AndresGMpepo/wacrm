-- Formal supervisor ownership for current critical AI conversations.
-- This is deliberately separate from internal notes: notes are collaboration
-- context, while this table is the durable operational state machine.
CREATE TABLE IF NOT EXISTS supervision_interventions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'resolved')),
  started_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL DEFAULT now(),
  resolved_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_supervision_interventions_account_status
  ON supervision_interventions(account_id, status, updated_at DESC);

ALTER TABLE supervision_interventions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supervision_interventions_admin_read ON supervision_interventions;
DROP POLICY IF EXISTS supervision_interventions_admin_write ON supervision_interventions;

CREATE POLICY supervision_interventions_admin_read ON supervision_interventions
  FOR SELECT USING (is_account_member(account_id, 'admin'));

CREATE POLICY supervision_interventions_admin_write ON supervision_interventions
  FOR ALL USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'supervision_interventions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE supervision_interventions;
  END IF;
END $$;
