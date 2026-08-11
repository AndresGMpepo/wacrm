-- Snapshot the automatic session-close policy reported by each Yeastar Live
-- Chat channel. The PBX remains the source of truth; WACRM refreshes this
-- snapshot without exposing any OpenAPI credentials to the browser.
ALTER TABLE public.omnichannel_connectors
  ADD COLUMN IF NOT EXISTS yeastar_channel_api_id INTEGER,
  ADD COLUMN IF NOT EXISTS session_auto_close BOOLEAN,
  ADD COLUMN IF NOT EXISTS session_timeout_value INTEGER
    CHECK (session_timeout_value IS NULL OR session_timeout_value > 0),
  ADD COLUMN IF NOT EXISTS session_timeout_unit TEXT
    CHECK (session_timeout_unit IS NULL OR session_timeout_unit IN ('minite', 'hour', 'day')),
  ADD COLUMN IF NOT EXISTS session_policy_synced_at TIMESTAMPTZ;

COMMENT ON COLUMN public.omnichannel_connectors.yeastar_channel_api_id IS
  'Internal numeric Live Chat channel ID resolved through Yeastar OpenAPI.';
COMMENT ON COLUMN public.omnichannel_connectors.session_auto_close IS
  'Latest automatic-close setting queried from Yeastar for this connector.';
