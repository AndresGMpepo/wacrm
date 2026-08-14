-- Manual, auditable attribution between a commercial deal and a broadcast.
--
-- A reply to a campaign is not a sale. The team explicitly selects the
-- campaign when creating or updating a deal. The trigger prevents a deal
-- from being linked to a broadcast that belongs to another account.

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS source_broadcast_id uuid
  REFERENCES public.broadcasts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_deals_source_broadcast
  ON public.deals(account_id, source_broadcast_id)
  WHERE source_broadcast_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_deal_source_broadcast_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  broadcast_account_id uuid;
BEGIN
  IF NEW.source_broadcast_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT account_id
    INTO broadcast_account_id
  FROM public.broadcasts
  WHERE id = NEW.source_broadcast_id;

  IF broadcast_account_id IS NULL OR broadcast_account_id IS DISTINCT FROM NEW.account_id THEN
    RAISE EXCEPTION 'La campaña seleccionada no pertenece a esta cuenta.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deals_validate_source_broadcast_scope ON public.deals;
CREATE TRIGGER deals_validate_source_broadcast_scope
  BEFORE INSERT OR UPDATE OF account_id, source_broadcast_id ON public.deals
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_deal_source_broadcast_scope();

COMMENT ON COLUMN public.deals.source_broadcast_id IS
  'Campaign explicitly selected by the team as the origin of this deal; never inferred automatically.';
