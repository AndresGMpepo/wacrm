-- Keep PBX channel identifiers separate from the agent-facing live-call row.
-- Yeastar may report a trunk member without the answering extension, while
-- Call Listen requires the active PBX channel_id for the monitored call.
CREATE TABLE IF NOT EXISTS yeastar_live_call_channels (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  call_id text NOT NULL,
  channel_id text NOT NULL,
  member_type text NOT NULL CHECK (member_type IN ('extension', 'inbound', 'outbound', 'internal')),
  member_number text,
  from_number text,
  to_number text,
  status text NOT NULL,
  last_event_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, call_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_yeastar_live_call_channels_account_call
  ON yeastar_live_call_channels(account_id, call_id, last_event_at DESC);

ALTER TABLE yeastar_live_call_channels ENABLE ROW LEVEL SECURITY;
-- Server routes enforce account role and never expose PBX channel IDs to the browser.
