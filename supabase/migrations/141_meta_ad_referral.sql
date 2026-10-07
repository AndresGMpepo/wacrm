-- Facebook/Instagram Click-to-Messenger (CTM) ads attach referral context
-- (ad_id, ref, ads_context_data) to the inbound message that opened the
-- thread from the ad — this is what Meta's own Messenger/Instagram app
-- shows as "Esto es una respuesta a un anuncio" with a "Ver detalles" link.
-- See src/app/api/omnichannel/meta/webhook/route.ts (ingestMessage) for the
-- producer and src/components/inbox/ad-referral-banner.tsx for the UI.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS ad_referral JSONB;

COMMENT ON COLUMN public.messages.ad_referral IS
  'Click-to-Messenger ad referral context (ad_id, ref, ad_title, photo_url, video_url, post_id, product_id) from the Meta "messages" webhook''s message.referral field. Null for everything except the specific inbound message that carried it (normally the first customer message in the conversation).';
