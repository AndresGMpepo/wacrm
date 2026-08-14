-- ============================================================
-- 079_meta_social_comments.sql
--
-- Public Facebook/Instagram comments are related to the same customer but
-- are not private DMs. Keep the original post and root-comment identifiers
-- on the conversation so replies can only be published in the right thread.
-- ============================================================

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS social_comment_id TEXT,
  ADD COLUMN IF NOT EXISTS social_parent_comment_id TEXT,
  ADD COLUMN IF NOT EXISTS social_post_id TEXT;

CREATE INDEX IF NOT EXISTS idx_conversations_social_comment
  ON public.conversations(connector_id, social_comment_id)
  WHERE social_comment_id IS NOT NULL;

COMMENT ON COLUMN public.conversations.social_comment_id IS
  'Root public Meta comment ID. Its presence means this is a public social comment thread, not a private DM.';
COMMENT ON COLUMN public.conversations.social_parent_comment_id IS
  'Parent Meta comment or post ID reported for the first incoming comment.';
COMMENT ON COLUMN public.conversations.social_post_id IS
  'Meta post/media ID that owns this public comment thread.';
