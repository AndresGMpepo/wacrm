-- ============================================================
-- 128 · Add the 'supervisor' account role
--
-- New tier between 'agent' and 'admin': same day-to-day access as an
-- agent (assigned/unassigned chats, contacts, pipelines, appointments,
-- tasks), PLUS full access to Broadcasts, Reports, Call transcriptions
-- and Supervision — WITHOUT admin-only capabilities (Settings,
-- integrations, billing, member management, Automations/Flows, AI
-- Agents config).
--
-- Split into its own migration: PostgreSQL won't let a freshly added
-- enum value be referenced by name in the SAME transaction it was
-- added in. The ranking function + RLS policy updates that actually
-- USE 'supervisor' live in the next migration (129).
-- ============================================================

ALTER TYPE account_role_enum ADD VALUE IF NOT EXISTS 'supervisor' BEFORE 'admin';
