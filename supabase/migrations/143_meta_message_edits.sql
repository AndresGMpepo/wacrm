-- Messenger lets a customer edit a message they already sent (up to 5
-- times, enforced client-side by Meta) and notifies the Page via the
-- message_edits webhook — see ingestMessageEdit() in
-- src/app/api/omnichannel/meta/webhook/route.ts. We overwrite
-- content_text in place (no edit history) and stamp edited_at so the
-- inbox can show an "(editado)" tag instead of silently going stale.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

COMMENT ON COLUMN public.messages.edited_at IS
  'Set when a customer edited this message after sending it (Facebook Messenger only — message_edits webhook). content_text holds the latest edited text, not the original.';
