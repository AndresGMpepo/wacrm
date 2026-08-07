-- Human-controlled call follow-ups. The worker only creates a task after
-- silence; it never places a call or accesses a user's softphone.
CREATE TABLE IF NOT EXISTS call_follow_up_policies (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  no_reply_minutes integer NOT NULL DEFAULT 120 CHECK (no_reply_minutes BETWEEN 5 AND 10080),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS call_follow_up_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  assigned_agent_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  due_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  source text NOT NULL DEFAULT 'no_reply' CHECK (source IN ('no_reply', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  outcome text CHECK (char_length(outcome) <= 1000)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_call_follow_up_one_pending
  ON call_follow_up_tasks(account_id, conversation_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_call_follow_up_queue
  ON call_follow_up_tasks(account_id, status, due_at);

ALTER TABLE call_follow_up_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_follow_up_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS call_follow_up_policies_member_select ON call_follow_up_policies;
DROP POLICY IF EXISTS call_follow_up_policies_admin_manage ON call_follow_up_policies;
CREATE POLICY call_follow_up_policies_member_select ON call_follow_up_policies FOR SELECT USING (is_account_member(account_id));
CREATE POLICY call_follow_up_policies_admin_manage ON call_follow_up_policies FOR ALL USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS call_follow_up_tasks_member_select ON call_follow_up_tasks;
CREATE POLICY call_follow_up_tasks_member_select ON call_follow_up_tasks FOR SELECT USING (is_account_member(account_id));

DROP TRIGGER IF EXISTS call_follow_up_policies_updated_at ON call_follow_up_policies;
CREATE TRIGGER call_follow_up_policies_updated_at BEFORE UPDATE ON call_follow_up_policies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
