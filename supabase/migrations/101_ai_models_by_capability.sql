-- Lets each account route AI work to a model suited to its task while
-- preserving the existing `model` column as the fallback for old configs.
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS analysis_model text,
  ADD COLUMN IF NOT EXISTS image_analysis_model text,
  ADD COLUMN IF NOT EXISTS voice_transcription_model text;
