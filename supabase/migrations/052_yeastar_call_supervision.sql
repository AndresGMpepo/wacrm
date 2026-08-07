-- Yeastar OpenAPI monitoring is separate from Linkus WebRTC credentials.
-- Secrets remain server-only and encrypted by the application.
CREATE TABLE IF NOT EXISTS yeastar_monitoring_configs (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  api_client_id text,
  api_client_secret text,
  webhook_secret text,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yeastar_live_calls (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  call_id text NOT NULL,
  extension text NOT NULL,
  channel_id text NOT NULL,
  peer_number text,
  direction text NOT NULL DEFAULT 'unknown'
    CHECK (direction IN ('inbound', 'outbound', 'internal', 'unknown')),
  status text NOT NULL,
  call_path text,
  last_event_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, call_id, extension)
);

CREATE INDEX IF NOT EXISTS idx_yeastar_live_calls_account_updated
  ON yeastar_live_calls(account_id, last_event_at DESC);

-- Created now so the later Listen/Whisper/Barge block has an immutable,
-- account-scoped audit trail from its first action.
CREATE TABLE IF NOT EXISTS yeastar_call_supervision_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  supervisor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  supervisor_extension text NOT NULL,
  target_extension text NOT NULL,
  call_id text NOT NULL,
  channel_id text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('listen', 'whisper', 'barge')),
  outcome text NOT NULL DEFAULT 'requested' CHECK (outcome IN ('requested', 'succeeded', 'failed')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_yeastar_supervision_audit_account_created
  ON yeastar_call_supervision_audit(account_id, created_at DESC);

ALTER TABLE yeastar_monitoring_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE yeastar_live_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE yeastar_call_supervision_audit ENABLE ROW LEVEL SECURITY;
-- Browser access is deliberately forbidden. Route handlers use the service
-- role after checking the account role, so API secrets and live-call details
-- never become public Supabase data.

DROP TRIGGER IF EXISTS yeastar_monitoring_configs_updated_at ON yeastar_monitoring_configs;
CREATE TRIGGER yeastar_monitoring_configs_updated_at
  BEFORE UPDATE ON yeastar_monitoring_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
