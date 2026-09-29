-- ============================================================
-- 131 · Multi-number contacts — track which phone sent each message
--
-- A contact can legitimately have more than one active WhatsApp number
-- at once (e.g. a business line and a personal line), not just an old
-- number recovered from a merge (migration 127 added
-- contacts.alternate_phones for that). Today nothing records WHICH of a
-- contact's numbers actually sent a given inbound message — everything
-- funnels into one conversation per (contact, channel_type), so the
-- number itself was invisible once merged.
--
-- sender_phone is intentionally message-level (not conversation-level):
-- a single WhatsApp conversation thread can interleave messages from
-- both of the contact's numbers, and the agent needs to see which one
-- is which per message, not just once per thread.
-- ============================================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS sender_phone text;
