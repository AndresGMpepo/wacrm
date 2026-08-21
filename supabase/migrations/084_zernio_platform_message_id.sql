ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS platform_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_platform_message_id
  ON messages(platform_message_id)
  WHERE platform_message_id IS NOT NULL;
