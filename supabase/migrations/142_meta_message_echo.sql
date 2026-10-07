-- Lets a reply sent from Meta's own Facebook Page Inbox / Business Suite
-- (not through NexoOmni) still show up in the conversation thread here —
-- see ingestEcho() in src/app/api/omnichannel/meta/webhook/route.ts. Meta
-- tags every message sent via its own Page Inbox with a fixed app_id
-- (26390203743090, documented on the message_echoes webhook event); this
-- column records that so the inbox can show "Enviado desde Meta".
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS sent_via_meta_inbox BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.messages.sent_via_meta_inbox IS
  'True when this agent message was synced from a Facebook/Instagram message_echoes webhook event whose app_id matched Meta''s Page Inbox app (26390203743090) — i.e. an agent replied from Meta directly instead of from NexoOmni.';
