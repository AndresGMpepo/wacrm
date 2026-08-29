-- Nexo Memory (Fase 1: Identity + Memory Core).
-- Identity unification already exists: contacts.phone_normalized (unique per
-- account) plus omnichannel_contact_identities (connector + external_user_id
-- -> contact_id) resolve the same person across WhatsApp/voice/Meta/webchat,
-- and merge_contacts() lets an admin fix mistaken duplicates. This migration
-- only adds the memory layer on top of the existing contact_id, on purpose:
-- no separate "customers" table, so every feature that already relies on
-- contacts (conversations, deals, broadcasts, calls) keeps working unchanged.

-- Consolidated, always-current knowledge about a contact. One row per
-- contact; it is overwritten (not appended) every time new memory is derived.
CREATE TABLE IF NOT EXISTS public.contact_memory (
  contact_id uuid PRIMARY KEY REFERENCES public.contacts(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  current_summary text,
  current_stage text,
  sentiment text CHECK (sentiment IN ('positive', 'neutral', 'negative', 'mixed')),
  sentiment_score integer CHECK (sentiment_score BETWEEN 0 AND 100),
  risk_level text CHECK (risk_level IN ('low', 'medium', 'high')),
  opportunity_score integer CHECK (opportunity_score BETWEEN 0 AND 100),
  next_best_action text,
  last_source_conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contact_memory_account_idx ON public.contact_memory(account_id);
ALTER TABLE public.contact_memory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_memory_member_select ON public.contact_memory;
CREATE POLICY contact_memory_member_select ON public.contact_memory FOR SELECT USING (is_account_member(account_id));

-- Episodic timeline: individual dated events, never overwritten.
CREATE TABLE IF NOT EXISTS public.contact_memory_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  event_type text NOT NULL DEFAULT 'fact' CHECK (event_type IN ('fact', 'conversation_analyzed', 'call_analyzed', 'manual')),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 500),
  importance text NOT NULL DEFAULT 'normal' CHECK (importance IN ('low', 'normal', 'high')),
  confidence numeric(3, 2) NOT NULL DEFAULT 0.75 CHECK (confidence BETWEEN 0 AND 1),
  source_type text NOT NULL CHECK (source_type IN ('conversation', 'call', 'manual')),
  source_id uuid,
  event_date timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contact_memory_events_contact_idx ON public.contact_memory_events(contact_id, event_date DESC);
ALTER TABLE public.contact_memory_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_memory_events_member_select ON public.contact_memory_events;
CREATE POLICY contact_memory_events_member_select ON public.contact_memory_events FOR SELECT USING (is_account_member(account_id));

-- Standalone facts (interest/objection/attribute) with confidence and
-- validity window so a newer statement can supersede an older one instead of
-- both living forever ("20 empleados" vs "45 empleados").
CREATE TABLE IF NOT EXISTS public.contact_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('interest', 'objection', 'attribute', 'other')),
  fact text NOT NULL CHECK (char_length(fact) BETWEEN 1 AND 300),
  confidence numeric(3, 2) NOT NULL DEFAULT 0.75 CHECK (confidence BETWEEN 0 AND 1),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'disputed')),
  source_type text NOT NULL CHECK (source_type IN ('conversation', 'call', 'manual')),
  source_id uuid,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contact_facts_contact_idx ON public.contact_facts(contact_id, status);
ALTER TABLE public.contact_facts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_facts_member_select ON public.contact_facts;
CREATE POLICY contact_facts_member_select ON public.contact_facts FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS contact_facts_admin_update ON public.contact_facts;
CREATE POLICY contact_facts_admin_update ON public.contact_facts FOR UPDATE USING (is_account_member(account_id, 'admin'));

-- "Enviar cotización viernes", "cliente enviará documentación", etc.
CREATE TABLE IF NOT EXISTS public.contact_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 300),
  owner text NOT NULL DEFAULT 'agent' CHECK (owner IN ('agent', 'customer')),
  due_date date,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'overdue', 'cancelled')),
  source_type text NOT NULL CHECK (source_type IN ('conversation', 'call', 'manual')),
  source_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contact_commitments_contact_idx ON public.contact_commitments(contact_id, status);
ALTER TABLE public.contact_commitments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_commitments_member_select ON public.contact_commitments;
CREATE POLICY contact_commitments_member_select ON public.contact_commitments FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS contact_commitments_agent_insert ON public.contact_commitments;
CREATE POLICY contact_commitments_agent_insert ON public.contact_commitments FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS contact_commitments_agent_update ON public.contact_commitments;
CREATE POLICY contact_commitments_agent_update ON public.contact_commitments FOR UPDATE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS contact_commitments_updated_at ON public.contact_commitments;
CREATE TRIGGER contact_commitments_updated_at BEFORE UPDATE ON public.contact_commitments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
