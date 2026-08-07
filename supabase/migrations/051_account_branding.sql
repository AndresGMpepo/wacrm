-- Per-account identity. The name already belongs to accounts; this adds a
-- separately scoped logo without changing users or other tenants.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS logo_url text
  CHECK (logo_url IS NULL OR char_length(logo_url) <= 2048);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'account-branding',
  'account-branding',
  TRUE,
  2097152,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Account branding is publicly readable" ON storage.objects;
CREATE POLICY "Account branding is publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'account-branding');

DROP POLICY IF EXISTS "Account admins can insert branding" ON storage.objects;
CREATE POLICY "Account admins can insert branding"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'account-branding'
    AND (storage.foldername(name))[1] = (
      'account-' || (SELECT account_id::text FROM profiles WHERE user_id = auth.uid())
    )
    AND is_account_member(
      (SELECT account_id FROM profiles WHERE user_id = auth.uid()),
      'admin'
    )
  );

DROP POLICY IF EXISTS "Account admins can update branding" ON storage.objects;
CREATE POLICY "Account admins can update branding"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'account-branding'
    AND (storage.foldername(name))[1] = (
      'account-' || (SELECT account_id::text FROM profiles WHERE user_id = auth.uid())
    )
    AND is_account_member(
      (SELECT account_id FROM profiles WHERE user_id = auth.uid()),
      'admin'
    )
  )
  WITH CHECK (
    bucket_id = 'account-branding'
    AND (storage.foldername(name))[1] = (
      'account-' || (SELECT account_id::text FROM profiles WHERE user_id = auth.uid())
    )
    AND is_account_member(
      (SELECT account_id FROM profiles WHERE user_id = auth.uid()),
      'admin'
    )
  );

DROP POLICY IF EXISTS "Account admins can delete branding" ON storage.objects;
CREATE POLICY "Account admins can delete branding"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'account-branding'
    AND (storage.foldername(name))[1] = (
      'account-' || (SELECT account_id::text FROM profiles WHERE user_id = auth.uid())
    )
    AND is_account_member(
      (SELECT account_id FROM profiles WHERE user_id = auth.uid()),
      'admin'
    )
  );
