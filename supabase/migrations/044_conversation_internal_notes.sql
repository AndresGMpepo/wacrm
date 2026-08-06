-- Internal notes belong to a single conversation and are never sent to Meta
-- or rendered as customer messages.
CREATE TABLE IF NOT EXISTS conversation_internal_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversation_internal_notes_conversation_created
  ON conversation_internal_notes(conversation_id, created_at DESC);

ALTER TABLE conversation_internal_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_internal_notes_select ON conversation_internal_notes;
DROP POLICY IF EXISTS conversation_internal_notes_insert ON conversation_internal_notes;
CREATE POLICY conversation_internal_notes_select ON conversation_internal_notes FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY conversation_internal_notes_insert ON conversation_internal_notes FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent') AND author_user_id = auth.uid());

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'conversation_internal_notes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE conversation_internal_notes;
  END IF;
END $$;
