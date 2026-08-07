-- Durable, compact diagnostics for signed Yeastar event delivery. We retain
-- metadata only (never OpenAPI/WebRTC secrets or raw audio) so an admin can
-- distinguish a PBX delivery problem from an event-parsing problem.
CREATE TABLE IF NOT EXISTS yeastar_webhook_event_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_type text,
  call_id text,
  outcome text NOT NULL CHECK (outcome IN ('processed', 'ignored', 'rejected', 'invalid')),
  detail text,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_yeastar_webhook_receipts_account_received
  ON yeastar_webhook_event_receipts(account_id, received_at DESC);

ALTER TABLE yeastar_webhook_event_receipts ENABLE ROW LEVEL SECURITY;
-- No browser policies: the monitoring configuration endpoint exposes a small
-- admin-only diagnostic view without exposing raw webhook data.
