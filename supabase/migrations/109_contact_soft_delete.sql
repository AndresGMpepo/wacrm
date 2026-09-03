-- ============================================================
-- 109 · Contacts are archived, not destroyed
--
-- Deleting a contact used to be a hard DELETE available to any `agent`,
-- and `conversations.contact_id` cascades — so one click erased every
-- conversation and message of that customer, permanently. That is data
-- loss (and, for a leaving agent, an easy way to cover tracks).
--
-- From here on the product archives (`deleted_at`), the history stays,
-- and a real DELETE is reserved for the account owner / platform
-- operator. Every archive, restore and hard delete is audited.
-- ============================================================

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.contacts.deleted_at IS
  'Archived (soft-deleted) at. Rows with a value are hidden from lists and audiences but keep their conversations.';

-- Every list query filters on this, so index the live rows only.
CREATE INDEX IF NOT EXISTS contacts_active_idx
  ON public.contacts(account_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------
-- Audit trail
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contact_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  -- Kept after a hard delete: the snapshot is the point of the record.
  contact_id uuid,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('archived', 'restored', 'deleted')),
  reason text,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_audit_log_account_created_idx
  ON public.contact_audit_log(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS contact_audit_log_contact_idx
  ON public.contact_audit_log(contact_id);

ALTER TABLE public.contact_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_audit_log_admin_select ON public.contact_audit_log;
CREATE POLICY contact_audit_log_admin_select ON public.contact_audit_log
  FOR SELECT USING (is_account_member(account_id, 'admin'));
-- Writes only through the service role (the archive/restore/delete routes),
-- so the log cannot be forged or trimmed from the client.

-- ------------------------------------------------------------
-- Hard delete is owner-only from now on
-- ------------------------------------------------------------
DROP POLICY IF EXISTS contacts_delete ON public.contacts;
CREATE POLICY contacts_delete ON public.contacts
  FOR DELETE USING (is_account_member(account_id, 'owner'));

-- ------------------------------------------------------------
-- Archived contacts must not come back through the tag filter
-- (same body as migration 025 plus the deleted_at guard).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.filter_contacts_by_tags(
  p_tag_ids UUID[],
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (contact contacts, total_count BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH matched AS (
    SELECT DISTINCT c.id, c.created_at
    FROM contacts c
    JOIN contact_tags ct ON ct.contact_id = c.id
    WHERE ct.tag_id = ANY(p_tag_ids)
      AND c.deleted_at IS NULL
      AND (
        p_search IS NULL
        OR c.name ILIKE '%' || p_search || '%'
        OR c.phone ILIKE '%' || p_search || '%'
        OR c.email ILIKE '%' || p_search || '%'
      )
  ),
  page AS (
    SELECT id, count(*) OVER() AS total_count
    FROM matched
    ORDER BY created_at DESC, id
    LIMIT p_limit OFFSET p_offset
  )
  SELECT c AS contact, page.total_count
  FROM page
  JOIN contacts c ON c.id = page.id
  ORDER BY c.created_at DESC, c.id;
$$;

ALTER FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT) TO authenticated;
