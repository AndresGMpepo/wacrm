// ============================================================
// GET /api/v1/team-members (scope: conversations:assign)
//
// An automation which is allowed to assign work needs a safe way to
// discover the active destination member ids. The response intentionally
// excludes emails, avatars and any authentication data.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond';

type MemberRow = {
  user_id: string;
  full_name: string | null;
  account_role: string;
};

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'conversations:assign');
    const { data, error } = await ctx.supabase
      .from('profiles')
      .select('user_id, full_name, account_role')
      .eq('account_id', ctx.accountId)
      .eq('is_active', true)
      .order('full_name', { ascending: true });

    if (error) {
      console.error('[api/v1/team-members] list error:', error);
      return fail('internal', 'Failed to list active team members', 500);
    }

    return ok(
      ((data ?? []) as MemberRow[]).map((member) => ({
        user_id: member.user_id,
        full_name: member.full_name ?? '',
        role: member.account_role,
      }))
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
