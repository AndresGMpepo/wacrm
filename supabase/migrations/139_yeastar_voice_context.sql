ALTER TABLE public.yeastar_call_transcriptions
  ADD COLUMN analysis_status text NOT NULL DEFAULT 'pending'
    CHECK (analysis_status IN ('pending', 'completed', 'failed', 'unavailable')),
  ADD COLUMN analysis_error text,
  ADD COLUMN memory_applied_at timestamptz,
  ADD COLUMN next_sync_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN sync_claimed_at timestamptz;

-- Previously completed transcripts may still lack analysis or customer linkage.
UPDATE public.yeastar_call_transcriptions SET analysis_status = 'pending';
CREATE INDEX yeastar_call_sync_due ON public.yeastar_call_transcriptions(next_sync_at)
  WHERE transcription_status IN ('pending', 'failed') OR analysis_status IN ('pending', 'failed');

CREATE TABLE public.yeastar_call_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  call_id text NOT NULL,
  customer_phone text NOT NULL,
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 800),
  customer_need text,
  next_action text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id, call_id)
);
ALTER TABLE public.yeastar_call_handoffs ENABLE ROW LEVEL SECURITY;
-- Live-call and extension tables intentionally have no browser policies.
-- Check ownership inside a narrowly scoped definer rather than an RLS join
-- that would always see zero rows for an agent.
CREATE FUNCTION public.can_view_yeastar_handoff(p_account_id uuid, p_call_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_account_member(p_account_id, 'supervisor') OR (
    public.is_account_member(p_account_id, 'agent') AND EXISTS (
      SELECT 1 FROM public.yeastar_live_calls l
      JOIN public.telephony_user_configs t ON t.account_id = l.account_id
        AND t.extension = l.extension AND t.provider = 'yeastar'
      WHERE l.account_id = p_account_id AND l.call_id = p_call_id
        AND t.user_id = auth.uid() AND l.status <> 'BYE'
    )
  );
$$;
REVOKE ALL ON FUNCTION public.can_view_yeastar_handoff(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_yeastar_handoff(uuid, text) TO authenticated, service_role;
-- Writes are exclusively from the authenticated, account-scoped API-key tool.
CREATE POLICY yeastar_handoff_select ON public.yeastar_call_handoffs FOR SELECT USING (
  public.can_view_yeastar_handoff(account_id, call_id)
);
