-- Nexo Memory doesn't push live updates: when analysis completes for one of
-- a contact's conversations (e.g. an Instagram thread), the inbox sidebar's
-- Nexo Memory panel/omnichannel history for that SAME contact's other
-- conversation (e.g. WhatsApp) never refreshed until a full page reload,
-- because contact_memory/contact_facts/contact_commitments/
-- contact_memory_events were never added to the Realtime publication.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'contact_memory'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE contact_memory;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'contact_memory_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE contact_memory_events;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'contact_facts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE contact_facts;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'contact_commitments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE contact_commitments;
  END IF;
END $$;

-- UPDATE payloads need old-column data for accurate client-side diffing
-- (mirrors the notifications table's REPLICA IDENTITY FULL from 027).
ALTER TABLE contact_memory REPLICA IDENTITY FULL;
ALTER TABLE contact_memory_events REPLICA IDENTITY FULL;
ALTER TABLE contact_facts REPLICA IDENTITY FULL;
ALTER TABLE contact_commitments REPLICA IDENTITY FULL;
