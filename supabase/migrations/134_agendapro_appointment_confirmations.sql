-- ============================================================
-- 134 · AgendaPro appointment confirmations (24h before, WhatsApp)
--
-- Adds the state needed to:
--   1. Send the client a WhatsApp template reminder ~24h before an
--      AgendaPro booking's start_time, asking them to reply SI/NO.
--   2. Record whether they confirmed, declined, or never answered.
--   3. Alert reception (in-app notification + WhatsApp template to a
--      configured reception number) when a booking stays unconfirmed.
--
-- Cron processing lives in the existing single worker
-- (/api/internal/ai-analysis-worker — see docs/development-practices.md,
-- "tareas periódicas"), not a new HTTP endpoint.
-- ============================================================

-- One row per tenant already exists in agendapro_configs (133). These
-- columns are all opt-in (enabled defaults to false) so nothing starts
-- sending until the account has an approved Meta template and turns it
-- on from Settings → AgendaPro.
ALTER TABLE public.agendapro_configs
  ADD COLUMN IF NOT EXISTS confirmation_reminder_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reception_phone TEXT,
  ADD COLUMN IF NOT EXISTS confirmation_template_name TEXT NOT NULL DEFAULT 'confirmacion_cita_24h',
  ADD COLUMN IF NOT EXISTS confirmation_template_language TEXT NOT NULL DEFAULT 'es_MX',
  ADD COLUMN IF NOT EXISTS reception_template_name TEXT NOT NULL DEFAULT 'aviso_recepcion_cita_sin_confirmar',
  ADD COLUMN IF NOT EXISTS reception_template_language TEXT NOT NULL DEFAULT 'es_MX';

-- Per-booking confirmation state.
ALTER TABLE public.agendapro_bookings
  ADD COLUMN IF NOT EXISTS confirmation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (confirmation_status IN ('pending', 'confirmed', 'declined')),
  ADD COLUMN IF NOT EXISTS confirmation_reminder_status TEXT NOT NULL DEFAULT 'queued'
    CHECK (confirmation_reminder_status IN ('queued', 'sending', 'sent', 'skipped', 'failed')),
  ADD COLUMN IF NOT EXISTS confirmation_reminder_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmation_reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmation_responded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reception_alert_sent_at TIMESTAMPTZ;

-- Backfill due_at for any booking synced before this migration, so the
-- reminder doesn't require a fresh webhook delivery to start being
-- scheduled.
UPDATE public.agendapro_bookings
SET confirmation_reminder_due_at = start_time - INTERVAL '24 hours'
WHERE confirmation_reminder_due_at IS NULL AND start_time IS NOT NULL;

-- Recomputes the reminder's due_at (and resets confirmation state)
-- whenever a booking is first synced or its start_time changes
-- (reschedule) — the webhook upsert (src/app/.../agendapro/webhook)
-- never sets these columns directly, so this trigger is the only place
-- that keeps them correct regardless of whether the booking came from
-- the webhook or a future pull-sync.
CREATE OR REPLACE FUNCTION public.agendapro_bookings_sync_confirmation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.start_time IS DISTINCT FROM OLD.start_time THEN
    NEW.confirmation_status := 'pending';
    NEW.confirmation_reminder_status := 'queued';
    NEW.confirmation_reminder_due_at := NEW.start_time - INTERVAL '24 hours';
    NEW.confirmation_reminder_sent_at := NULL;
    NEW.confirmation_responded_at := NULL;
    NEW.reception_alert_sent_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agendapro_bookings_sync_confirmation_trigger ON public.agendapro_bookings;
CREATE TRIGGER agendapro_bookings_sync_confirmation_trigger
  BEFORE INSERT OR UPDATE OF start_time ON public.agendapro_bookings
  FOR EACH ROW EXECUTE FUNCTION public.agendapro_bookings_sync_confirmation();

CREATE INDEX IF NOT EXISTS agendapro_bookings_confirmation_due_idx
  ON public.agendapro_bookings(confirmation_reminder_status, confirmation_reminder_due_at)
  WHERE confirmation_reminder_status = 'queued';

CREATE INDEX IF NOT EXISTS agendapro_bookings_confirmation_escalation_idx
  ON public.agendapro_bookings(confirmation_status, confirmation_reminder_sent_at)
  WHERE confirmation_status = 'pending' AND reception_alert_sent_at IS NULL;

-- New notification type for the in-app "recepción" alert. notifications.type
-- is a plain CHECK constraint (not a native enum), so — unlike a real
-- ALTER TYPE ... ADD VALUE — it's safe to redefine in the same migration
-- that will later reference it. 126_task_reminders.sql has the most
-- recent definition of this constraint; extending it here.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'conversation_assigned',
    'conversation_transferred',
    'incoming_message',
    'negative_sentiment',
    'call_follow_up',
    'nexo_memory_alert',
    'task_reminder',
    'agendapro_unconfirmed_appointment'
  ));

COMMENT ON COLUMN public.agendapro_configs.reception_phone IS
  'E.164 WhatsApp number for reception/staff alerts when a client does not confirm. Sent via reception_template_name (a template message, so it works outside the 24h customer-service window and regardless of whether this number has an open conversation).';
COMMENT ON COLUMN public.agendapro_bookings.confirmation_status IS
  'pending until the client replies SI/NO to the 24h reminder (or declines proactively); confirmed/declined otherwise. Reset to pending by the sync trigger whenever start_time changes (reschedule).';
