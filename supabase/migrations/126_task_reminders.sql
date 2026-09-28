-- ============================================================
-- 126 · Task reminders — precise-time follow-up tasks
--
-- contact_commitments already models "compromisos/pendientes" (AI-derived
-- from conversations/calls, and now also created manually), but due_date
-- is DATE-only — there was no way to notify an agent a few minutes before
-- a specific commitment time (e.g. "contáctame mañana a las 3pm", or a
-- softphone call ending with "llámame el día de mañana"). Adds:
--
--   - due_at: precise timestamp, populated only when a specific time is
--     actually known (manual creation always sets it; AI extraction only
--     when the customer/agent stated an actual time — see
--     src/lib/ai/memory.ts). NULL keeps the old day-only behavior.
--   - reminder_sent_at: dedup flag so the "N minutes before" cron alert
--     (src/app/api/internal/ai-analysis-worker/route.ts) fires exactly
--     once per task.
--   - assigned_agent_id: who gets that reminder — the creating agent for
--     manual tasks, the conversation's/call's assigned agent for
--     AI-derived ones. Falls back to account admins when unknown, same
--     rule the existing Nexo Memory alerts already use
--     (src/lib/notifications/nexo-memory-alerts.ts).
-- ============================================================

ALTER TABLE public.contact_commitments
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_agent_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Narrow scan target for the reminder cron: only pending tasks with a
-- precise time that haven't been reminded yet.
CREATE INDEX IF NOT EXISTS contact_commitments_due_at_idx
  ON public.contact_commitments(due_at)
  WHERE status = 'pending' AND due_at IS NOT NULL AND reminder_sent_at IS NULL;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'conversation_assigned',
    'conversation_transferred',
    'incoming_message',
    'negative_sentiment',
    'call_follow_up',
    'nexo_memory_alert',
    'task_reminder'
  ));
