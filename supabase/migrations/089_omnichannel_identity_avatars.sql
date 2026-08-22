-- A contact may use a different profile photo in WhatsApp, Facebook and
-- Instagram. Keep the provider's avatar on the channel identity rather than
-- overwriting the contact-level fallback photo.
ALTER TABLE public.omnichannel_contact_identities
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

COMMENT ON COLUMN public.omnichannel_contact_identities.avatar_url IS
  'HTTPS avatar URL reported by the provider for this connector-specific customer identity.';