ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS social_post_title TEXT,
  ADD COLUMN IF NOT EXISTS social_post_url TEXT,
  ADD COLUMN IF NOT EXISTS social_post_preview_url TEXT,
  ADD COLUMN IF NOT EXISTS social_ad_id TEXT,
  ADD COLUMN IF NOT EXISTS social_ad_title TEXT;

COMMENT ON COLUMN public.conversations.social_post_title IS
  'Text/caption of the public post that originated this comment thread, when Meta or Zernio provides it.';
COMMENT ON COLUMN public.conversations.social_post_url IS
  'Public permalink of the source publication, when the provider exposes one.';
COMMENT ON COLUMN public.conversations.social_post_preview_url IS
  'Provider media thumbnail for the source publication; may expire and is only a convenience preview.';
COMMENT ON COLUMN public.conversations.social_ad_id IS
  'Ad identifier supplied for a public comment on paid content, when available.';
COMMENT ON COLUMN public.conversations.social_ad_title IS
  'Ad creative title supplied with a public comment, when available.';
