-- ============================================================
-- 116 · Appointment availability
--
-- Appointments existed but nothing described WHEN they could happen:
-- there were no working hours, no way to ask for free slots, and no
-- protection against double-booking — `POST /api/appointments` inserted
-- whatever it was given, so two customers could hold the same hour with
-- the same specialist.
--
-- Three pieces:
--   1. `appointment_schedules` — recurring weekly working hours.
--   2. `appointment_schedule_exceptions` — holidays and one-off blocks.
--   3. An exclusion constraint so overlapping bookings are impossible at
--      the database level, not just in whichever code path remembered.
--
-- Schedules are owned by a specialist, by an agent, or by neither (both
-- NULL = the account's default hours, used when the resource has none of
-- its own).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS public.appointment_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  specialist_id uuid REFERENCES public.specialists(id) ON DELETE CASCADE,
  agent_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 0 = Sunday … 6 = Saturday, matching JavaScript's getDay().
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  slot_minutes integer NOT NULL DEFAULT 30 CHECK (slot_minutes BETWEEN 5 AND 480),
  -- Gap kept after each appointment (travel, notes, cleaning).
  buffer_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_minutes BETWEEN 0 AND 240),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time),
  -- A row belongs to one owner at most; both NULL means account default.
  CHECK (specialist_id IS NULL OR agent_user_id IS NULL)
);

CREATE INDEX IF NOT EXISTS appointment_schedules_account_idx
  ON public.appointment_schedules(account_id, weekday);
CREATE INDEX IF NOT EXISTS appointment_schedules_specialist_idx
  ON public.appointment_schedules(specialist_id) WHERE specialist_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS appointment_schedules_agent_idx
  ON public.appointment_schedules(agent_user_id) WHERE agent_user_id IS NOT NULL;

ALTER TABLE public.appointment_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS appointment_schedules_member_select ON public.appointment_schedules;
CREATE POLICY appointment_schedules_member_select ON public.appointment_schedules
  FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS appointment_schedules_admin_write ON public.appointment_schedules;
CREATE POLICY appointment_schedules_admin_write ON public.appointment_schedules
  FOR ALL USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS appointment_schedules_updated_at ON public.appointment_schedules;
CREATE TRIGGER appointment_schedules_updated_at BEFORE UPDATE ON public.appointment_schedules
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- Exceptions: holidays, vacations, one-off blocks
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.appointment_schedule_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  specialist_id uuid REFERENCES public.specialists(id) ON DELETE CASCADE,
  agent_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text CHECK (reason IS NULL OR char_length(reason) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (specialist_id IS NULL OR agent_user_id IS NULL)
);

CREATE INDEX IF NOT EXISTS appointment_schedule_exceptions_account_idx
  ON public.appointment_schedule_exceptions(account_id, starts_at);

ALTER TABLE public.appointment_schedule_exceptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS appointment_schedule_exceptions_member_select ON public.appointment_schedule_exceptions;
CREATE POLICY appointment_schedule_exceptions_member_select ON public.appointment_schedule_exceptions
  FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS appointment_schedule_exceptions_agent_write ON public.appointment_schedule_exceptions;
CREATE POLICY appointment_schedule_exceptions_agent_write ON public.appointment_schedule_exceptions
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- ------------------------------------------------------------
-- No double booking
--
-- Added only when the existing data allows it: an account that already
-- double-booked would otherwise fail the whole migration. The notice tells
-- the operator to clean up and re-run.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS appointments_specialist_range_idx
  ON public.appointments(specialist_id, starts_at)
  WHERE specialist_id IS NOT NULL AND status <> 'cancelled';

DO $$
DECLARE
  v_conflicts integer;
BEGIN
  SELECT count(*) INTO v_conflicts
  FROM appointments a
  JOIN appointments b
    ON a.id < b.id
   AND a.specialist_id = b.specialist_id
   AND a.status <> 'cancelled'
   AND b.status <> 'cancelled'
   AND tstzrange(a.starts_at, a.ends_at) && tstzrange(b.starts_at, b.ends_at)
  WHERE a.specialist_id IS NOT NULL;

  IF v_conflicts > 0 THEN
    RAISE NOTICE 'appointments: % overlapping specialist bookings already exist; the exclusion constraint was NOT added. Resolve them and re-run this migration.', v_conflicts;
  ELSE
    ALTER TABLE public.appointments
      DROP CONSTRAINT IF EXISTS appointments_no_specialist_overlap;
    ALTER TABLE public.appointments
      ADD CONSTRAINT appointments_no_specialist_overlap
      EXCLUDE USING gist (
        specialist_id WITH =,
        tstzrange(starts_at, ends_at) WITH &&
      ) WHERE (specialist_id IS NOT NULL AND status <> 'cancelled');
  END IF;
END $$;
