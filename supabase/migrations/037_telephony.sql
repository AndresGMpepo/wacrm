-- Account-wide PBX connector configuration. Secrets are encrypted by the
-- application before they reach this table; never expose these columns to a
-- browser query.
CREATE TABLE IF NOT EXISTS telephony_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'yeastar' CHECK (provider IN ('yeastar', 'sip')),
  pbx_url TEXT NOT NULL,
  yeastar_access_id TEXT,
  yeastar_access_key TEXT,
  extension TEXT,
  sip_websocket_url TEXT,
  sip_username TEXT,
  sip_password TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, provider)
);

ALTER TABLE telephony_configs ENABLE ROW LEVEL SECURITY;
-- There are deliberately no client policies. Even encrypted connector
-- credentials are sensitive and are read only by server Route Handlers using
-- the Supabase service role after they have checked the user's account role.
