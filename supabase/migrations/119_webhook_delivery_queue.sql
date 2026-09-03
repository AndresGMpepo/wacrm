-- Durable outbound webhook delivery. Payloads are retained only until the
-- final attempt, and no signing secret is ever copied out of its endpoint.
CREATE TABLE IF NOT EXISTS public.webhook_delivery_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  endpoint_id uuid NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  delivery_id uuid NOT NULL UNIQUE,
  event_type text NOT NULL,
  payload text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'delivered', 'dead_letter', 'skipped')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  last_http_status integer,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_delivery_jobs_due_idx
  ON public.webhook_delivery_jobs(next_attempt_at, created_at)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS webhook_delivery_jobs_account_idx
  ON public.webhook_delivery_jobs(account_id, created_at DESC);

ALTER TABLE public.webhook_delivery_jobs ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER webhook_delivery_jobs_updated_at
  BEFORE UPDATE ON public.webhook_delivery_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();