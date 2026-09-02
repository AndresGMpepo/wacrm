-- ============================================================
-- 104_zernio_whatsapp_templates_broadcasts.sql
--
-- Templates and broadcasts were native-WhatsApp-only (whatsapp_config).
-- Accounts that connect their WhatsApp number through Zernio instead
-- (omnichannel_connectors.provider = 'zernio_whatsapp') had no way to
-- create/sync templates or send broadcasts on that number. Both tables
-- get an optional connector_id: NULL keeps meaning "native whatsapp_config",
-- a value means "this specific Zernio-connected WhatsApp number".
-- ============================================================

ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS connector_id UUID REFERENCES omnichannel_connectors(id) ON DELETE SET NULL;

-- The existing unique index predates account sharing (migration 017 added
-- account_id but never migrated this index off user_id) and can't just
-- gain a nullable connector_id column: SQL treats NULL <> NULL, so two
-- native (connector_id IS NULL) rows with the same name+language would
-- NOT collide under a plain composite unique index. COALESCE to a
-- sentinel UUID so "native" is still a single, collidable identity per
-- account — and switch the key to account_id while at it, since two
-- different users on a shared account creating the same template name
-- was never meant to be allowed.
DO $$
DECLARE
  dupe_count int;
  sample text;
BEGIN
  SELECT count(*) INTO dupe_count FROM (
    SELECT account_id, name, language
    FROM message_templates
    GROUP BY account_id, name, language
    HAVING count(*) > 1
  ) dupes;

  IF dupe_count > 0 THEN
    SELECT string_agg(format('account=%s name=%s language=%s (x%s)', account_id, name, language, count), E'\n  ')
      INTO sample
      FROM (
        SELECT account_id, name, language, count(*) AS count
        FROM message_templates
        GROUP BY account_id, name, language
        HAVING count(*) > 1
      ) dupe_detail;

    RAISE EXCEPTION
      E'Cannot add UNIQUE(account_id, connector_id, name, language) on message_templates — % duplicate combination(s) already exist across users on the same account:\n  %\nMerge/delete the extra rows, then re-run migrations.',
      dupe_count, sample;
  END IF;
END $$;

DROP INDEX IF EXISTS message_templates_user_name_language_key;
CREATE UNIQUE INDEX IF NOT EXISTS message_templates_account_connector_name_language_key
  ON message_templates (account_id, COALESCE(connector_id, '00000000-0000-0000-0000-000000000000'::uuid), name, language);

CREATE INDEX IF NOT EXISTS idx_message_templates_connector
  ON message_templates(connector_id) WHERE connector_id IS NOT NULL;

ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS connector_id UUID REFERENCES omnichannel_connectors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_broadcasts_connector
  ON broadcasts(connector_id) WHERE connector_id IS NOT NULL;
