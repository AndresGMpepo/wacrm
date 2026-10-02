-- ============================================================
-- 137 · AI prompt variables ({{current_datetime}}, {{active_promotions}})
--
-- The AI reply assistant's system_prompt was always sent to the model
-- completely verbatim — an account author writing a literal
-- "{{current_datetime}}" placeholder got exactly that text echoed back,
-- never a real value (confirmed: buildSystemPrompt, src/lib/ai/
-- defaults.ts, does no substitution at all). This adds the state a real
-- substitution step (src/lib/ai/prompt-variables.ts) needs:
--
--   - ai_configs.timezone: which IANA zone "today"/"now" means for this
--     account's {{current_datetime}}. Defaults to America/Mexico_City,
--     same default as the AgendaPro integration (migration 136).
--   - ai_promotions: admin-managed promotions with a validity window
--     (starts_on/ends_on) — {{active_promotions}} is the formatted list
--     of whichever rows are active *today*, computed at send time, not
--     stored. No "is this the only one" assumption: a business can have
--     zero, one, or several promotions active at once.
-- ============================================================

ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Mexico_City';

CREATE TABLE IF NOT EXISTS public.ai_promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);

ALTER TABLE public.ai_promotions ENABLE ROW LEVEL SECURITY;

-- Same settings-class shape as ai_configs (029): any member can read
-- (so e.g. a future "upcoming promotions" display could show them),
-- only admin+ can write.
CREATE POLICY ai_promotions_select ON public.ai_promotions FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY ai_promotions_insert ON public.ai_promotions FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY ai_promotions_update ON public.ai_promotions FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY ai_promotions_delete ON public.ai_promotions FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- Narrow scan target for "which promotions are active today".
CREATE INDEX IF NOT EXISTS ai_promotions_account_dates_idx
  ON public.ai_promotions(account_id, starts_on, ends_on);

CREATE TRIGGER ai_promotions_updated_at
  BEFORE UPDATE ON public.ai_promotions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.ai_promotions IS
  'Admin-managed promotions with a validity window, surfaced to the AI assistant via the {{active_promotions}} prompt variable — see src/lib/ai/prompt-variables.ts.';
