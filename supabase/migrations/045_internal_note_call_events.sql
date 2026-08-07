-- Keeps softphone activity in the same internal conversation timeline.
ALTER TABLE conversation_internal_notes
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'note'
  CHECK (kind IN ('note', 'call_started'));
