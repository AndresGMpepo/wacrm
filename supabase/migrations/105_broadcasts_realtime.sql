-- The broadcast detail page fetched `broadcasts` and `broadcast_recipients`
-- once on mount with no live updates, so delivered/read/replied counters and
-- the funnel chart stayed frozen at whatever they were at page load (only
-- "sent" looked right because that count is set synchronously by the send
-- request itself). Neither table was ever added to the Realtime publication,
-- so the client-side subscription added alongside this migration would
-- otherwise receive nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'broadcasts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE broadcasts;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'broadcast_recipients'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE broadcast_recipients;
  END IF;
END $$;
