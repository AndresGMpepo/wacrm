-- ============================================================
-- 136 · AgendaPro timezone (corrects a mislabeled-UTC timestamp bug)
--
-- AgendaPro's "Agendapro Public V1" returns booking start/end as
-- "...Z" (as if UTC), but empirically (confirmed by the client
-- comparing AgendaPro's own calendar against NexoOmni's side by side)
-- that's actually the clinic's own local wall-clock time with a "Z"
-- tacked on, not a real UTC conversion — every booking displayed
-- exactly `timezone`'s UTC offset too early. The live calendar reads
-- directly from AgendaPro's API and is fixed client-side (see
-- src/lib/agendapro/time.ts, parsed literally instead of as UTC), but
-- the webhook-synced cache (agendapro_bookings.start_time/end_time,
-- a real `timestamptz` column) needs the actual tenant timezone to
-- compute the correct absolute instant before storing it — otherwise
-- the 24h-before confirmation reminder (134) fires relative to the
-- wrong instant.
--
-- Defaults to America/Mexico_City (this integration's only real
-- tenant so far); adjustable per account once more operate in other
-- zones.
-- ============================================================

ALTER TABLE public.agendapro_configs
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Mexico_City';

COMMENT ON COLUMN public.agendapro_configs.timezone IS
  'IANA timezone this AgendaPro account''s locations actually operate in. Used to correct booking start/end — see src/lib/agendapro/time.ts for why a correction is needed at all.';
