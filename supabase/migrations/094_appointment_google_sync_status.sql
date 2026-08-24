ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS google_sync_status TEXT NOT NULL DEFAULT 'not_connected'
    CHECK (google_sync_status IN ('not_connected', 'pending', 'synced', 'failed')),
  ADD COLUMN IF NOT EXISTS google_sync_error TEXT;