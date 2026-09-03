-- Appointment reminders retain their original conversation so outbound
-- messages always use the same channel that created the booking.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS source_conversation_id uuid
  REFERENCES public.conversations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS appointments_source_conversation_idx
  ON public.appointments(source_conversation_id)
  WHERE source_conversation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.appointment_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'sent', 'skipped', 'failed')),
  sent_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (appointment_id)
);

CREATE INDEX IF NOT EXISTS appointment_reminders_due_idx
  ON public.appointment_reminders(status, due_at)
  WHERE status = 'queued';

ALTER TABLE public.appointment_reminders ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER appointment_reminders_updated_at
  BEFORE UPDATE ON public.appointment_reminders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();