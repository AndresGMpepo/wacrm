-- Per-agent read state makes internal notes a durable follow-up signal,
-- rather than a visual detail that disappears when the agent changes page.
CREATE TABLE IF NOT EXISTS conversation_internal_note_reads (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

ALTER TABLE conversation_internal_note_reads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conversation_internal_note_reads_own ON conversation_internal_note_reads;
CREATE POLICY conversation_internal_note_reads_own ON conversation_internal_note_reads
  FOR ALL USING (user_id = auth.uid() AND is_account_member(account_id))
  WITH CHECK (user_id = auth.uid() AND is_account_member(account_id));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'conversation_internal_note_reads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE conversation_internal_note_reads;
  END IF;
END $$;
