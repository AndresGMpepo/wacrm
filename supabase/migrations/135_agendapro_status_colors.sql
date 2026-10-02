-- ============================================================
-- 135 · AgendaPro calendar status colors (per-account override map)
--
-- AgendaPro's own status_name values have no documented, fixed set
-- (see src/lib/agendapro/status-colors.ts), so instead of guessing a
-- hardcoded status→color mapping, each account can override the
-- color for any status it actually sees from Settings → AgendaPro.
-- Keyed by the same normalized (accent/case-insensitive) status text
-- the calendar groups bookings by. Unlisted statuses fall back to a
-- deterministic default computed client/server-side, not stored here.
-- ============================================================

ALTER TABLE public.agendapro_configs
  ADD COLUMN IF NOT EXISTS status_colors JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.agendapro_configs.status_colors IS
  'Per-account override map of normalized AgendaPro status_name -> hex color, for the calendar view. See src/lib/agendapro/status-colors.ts.';
