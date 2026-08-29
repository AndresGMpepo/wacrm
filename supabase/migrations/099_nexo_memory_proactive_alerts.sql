-- Nexo Memory Fase 5 (Proactividad): the platform stops waiting to be asked
-- and starts pushing actionable alerts through the existing notification
-- system (bell icon) instead of only showing up when someone opens Reports.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'incoming_message', 'negative_sentiment', 'call_follow_up', 'nexo_memory_alert'));

-- Mirrors ai_conversation_analyses.negative_alerted_at: prevents re-alerting
-- the same still-stale contact every single worker tick.
ALTER TABLE public.contact_memory
  ADD COLUMN IF NOT EXISTS stale_alerted_at timestamptz;
