-- Campaign-response traceability.
--
-- A broadcast reply is already counted by the webhook. This adds a nullable
-- link to the conversation where that reply arrived, so the team can open the
-- exact thread from a campaign detail. It does not claim a sale attribution.

ALTER TABLE public.broadcast_recipients
  ADD COLUMN IF NOT EXISTS response_conversation_id uuid
  REFERENCES public.conversations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_response_conversation
  ON public.broadcast_recipients(response_conversation_id)
  WHERE response_conversation_id IS NOT NULL;

COMMENT ON COLUMN public.broadcast_recipients.response_conversation_id IS
  'Conversation receiving the first customer reply attributed to this broadcast recipient.';
