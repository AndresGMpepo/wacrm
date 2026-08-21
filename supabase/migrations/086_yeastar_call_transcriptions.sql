CREATE TABLE IF NOT EXISTS public.yeastar_call_transcriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  call_id TEXT NOT NULL,
  cdr_id TEXT,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  customer_phone TEXT,
  customer_name TEXT,
  customer_email TEXT,
  agent_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  agent_extension TEXT,
  direction TEXT CHECK (direction IN ('inbound', 'outbound', 'internal', 'unknown')),
  started_at TIMESTAMPTZ,
  answered_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  recording_url TEXT,
  transcript TEXT,
  summary TEXT,
  key_points JSONB NOT NULL DEFAULT '[]'::jsonb,
  action_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  language TEXT,
  transcription_status TEXT NOT NULL DEFAULT 'pending' CHECK (transcription_status IN ('pending', 'processing', 'completed', 'failed', 'unavailable')),
  error_message TEXT,
  yeastar_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, call_id)
);

CREATE INDEX IF NOT EXISTS idx_yeastar_call_transcriptions_account_date
  ON public.yeastar_call_transcriptions(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_yeastar_call_transcriptions_contact
  ON public.yeastar_call_transcriptions(account_id, contact_id);

ALTER TABLE public.yeastar_call_transcriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS yeastar_call_transcriptions_select ON public.yeastar_call_transcriptions;
CREATE POLICY yeastar_call_transcriptions_select ON public.yeastar_call_transcriptions
  FOR SELECT USING (is_account_member(account_id));
