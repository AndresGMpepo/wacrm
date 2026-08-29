-- Nexo Memory Fase 3 (Voice Memory): calls need their own "last source"
-- pointer alongside the existing conversation one, since contact_memory is
-- shared across every channel (chat + voice) but a call is not a row in
-- `conversations`.
ALTER TABLE public.contact_memory
  ADD COLUMN IF NOT EXISTS last_source_call_id uuid REFERENCES public.yeastar_call_transcriptions(id) ON DELETE SET NULL;
