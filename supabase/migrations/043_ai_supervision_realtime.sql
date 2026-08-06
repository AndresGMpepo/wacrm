-- Lets owner/admin supervision screens receive fresh completed analyses.
-- The table's existing RLS policy still scopes events to account members.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'ai_conversation_analyses'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE ai_conversation_analyses;
  END IF;
END $$;
