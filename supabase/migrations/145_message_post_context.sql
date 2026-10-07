-- Instagram / Facebook Messenger context about WHAT the customer is
-- writing from, delivered by Zernio on message.received
-- (https://docs.zernio.com/webhooks/inbox#messagereceived):
--   * metadata.storyReply { storyId, storyUrl }  — reply to one of our IG stories
--   * metadata.isStoryMention                    — customer mentioned us in their story
--   * attachments[].originalType ig_post / post / ig_reel / reel / ig_story
--                                                — customer shared one of our posts/reels
--                                                  (also how IG Click-to-Direct delivers the ad post)
--   * metadata.referral (non-ADS)                — chat opened from an ig.me / m.me link with ?ref=
--   * metadata.noRenderableContent               — Meta withholds the content from the API
-- Ad clicks keep using `ad_referral` (migration 141). Rendered by
-- src/components/inbox/post-context-card.tsx.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS post_context JSONB;

COMMENT ON COLUMN public.messages.post_context IS
  'Zernio Instagram/Messenger origin context for an inbound message: { kind: story_reply | story_mention | shared_post | shared_reel | shared_story | link_referral | unavailable, url?, story_id?, permalink?, ref?, source? }. Null for ordinary messages.';
