-- Manual channel attribution for commercial deals.
-- A deal may be linked to a campaign (074) and independently have a
-- confirmed originating channel. This is intentionally not inferred by AI.

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS source_channel text;

ALTER TABLE public.deals
  DROP CONSTRAINT IF EXISTS deals_source_channel_check;

ALTER TABLE public.deals
  ADD CONSTRAINT deals_source_channel_check
  CHECK (source_channel IS NULL OR source_channel IN (
    'whatsapp',
    'yeastar_live_chat',
    'yeastar_voice',
    'facebook',
    'instagram',
    'tiktok',
    'other'
  ));

CREATE INDEX IF NOT EXISTS idx_deals_account_source_channel_updated
  ON public.deals(account_id, source_channel, updated_at DESC)
  WHERE source_channel IS NOT NULL;

COMMENT ON COLUMN public.deals.source_channel IS
  'Commercial origin channel confirmed by the team. It may be proposed from a related conversation but is not inferred by AI.';
