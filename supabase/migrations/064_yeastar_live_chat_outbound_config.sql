-- A tenant can use Live Chat channels from more than one Yeastar PBX.
-- Keep the outbound OpenAPI connection on the connector, encrypted by WACRM,
-- so a support widget in a second PBX never reuses the voice PBX credentials.
ALTER TABLE public.omnichannel_connectors
  ADD COLUMN IF NOT EXISTS outbound_pbx_url TEXT
    CHECK (outbound_pbx_url IS NULL OR char_length(outbound_pbx_url) BETWEEN 8 AND 500),
  ADD COLUMN IF NOT EXISTS outbound_api_client_id TEXT,
  ADD COLUMN IF NOT EXISTS outbound_api_client_secret TEXT;

COMMENT ON COLUMN public.omnichannel_connectors.outbound_pbx_url IS
  'Yeastar PBX base URL used only to send replies for this Live Chat connector.';
COMMENT ON COLUMN public.omnichannel_connectors.outbound_api_client_id IS
  'AES-256-GCM encrypted Yeastar OpenAPI client ID; never returned to browsers.';
COMMENT ON COLUMN public.omnichannel_connectors.outbound_api_client_secret IS
  'AES-256-GCM encrypted Yeastar OpenAPI client secret; never returned to browsers.';
