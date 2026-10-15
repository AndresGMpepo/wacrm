-- Lets an account declare which PBX extension numbers belong to it, for the
-- case where one physical Yeastar PBX is shared by several NexoOmni tenants
-- (e.g. tenant A owns 1000-1120, tenant B owns 1121 and up, on the same
-- PBX). Without this, call events and the "Importar desde Yeastar" bulk
-- export for ANY extension on that PBX are accepted by whichever account's
-- webhook/API credentials happened to receive them. NULL/empty keeps
-- importing everything, matching the previous single-tenant-per-PBX
-- behavior. See src/lib/telephony/extension-scope.ts for the parser.
ALTER TABLE public.yeastar_monitoring_configs
  ADD COLUMN IF NOT EXISTS extension_filter text;

COMMENT ON COLUMN public.yeastar_monitoring_configs.extension_filter IS
  'Comma-separated extension ranges/singles this account owns on a shared PBX, e.g. "1000-1120,1200". NULL/empty means no restriction.';
