// ============================================================
// PATCH /api/v1/conversations/{id}/assignment
//
// Assigns a conversation to an active member of the same account, or
// unassigns it with `assigned_agent_id: null`. This is deliberately a
// separate scope from reads and message sending so an automation cannot
// take ownership of customer work unless an administrator opted in.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  CONVERSATION_SELECT,
  normalizeConversation,
} from '@/lib/inbox/conversations';
import { serializeConversation } from '@/lib/api/v1/conversations';
import type { Conversation } from '@/types';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'conversations:assign');
    const { id } = await params;
    const payload = await request.json().catch(() => null);
    const assignedAgentId = payload?.assigned_agent_id;

    if (assignedAgentId !== null && typeof assignedAgentId !== 'string') {
      return fail(
        'bad_request',
        "'assigned_agent_id' must be an active team member id or null",
        400
      );
    }

    const { data: current, error: currentError } = await ctx.supabase
      .from('conversations')
      .select('id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (currentError) {
      console.error('[api/v1/conversation assignment] read error:', currentError);
      return fail('internal', 'Failed to read conversation', 500);
    }
    if (!current) return fail('not_found', 'Conversation not found', 404);

    if (typeof assignedAgentId === 'string') {
      const memberId = assignedAgentId.trim();
      if (!memberId) {
        return fail('bad_request', "'assigned_agent_id' cannot be empty", 400);
      }
      const { data: member, error: memberError } = await ctx.supabase
        .from('profiles')
        .select('user_id')
        .eq('user_id', memberId)
        .eq('account_id', ctx.accountId)
        .eq('is_active', true)
        .maybeSingle();
      if (memberError) {
        console.error('[api/v1/conversation assignment] member read error:', memberError);
        return fail('internal', 'Failed to validate team member', 500);
      }
      if (!member) {
        return fail(
          'bad_request',
          "'assigned_agent_id' must belong to an active member of this account",
          400
        );
      }
    }

    const { error: updateError } = await ctx.supabase
      .from('conversations')
      .update({ assigned_agent_id: assignedAgentId === null ? null : assignedAgentId.trim() })
      .eq('id', id)
      .eq('account_id', ctx.accountId);
    if (updateError) {
      console.error('[api/v1/conversation assignment] update error:', updateError);
      return fail('internal', 'Failed to assign conversation', 500);
    }

    const { data, error } = await ctx.supabase
      .from('conversations')
      .select(CONVERSATION_SELECT)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .single();
    if (error || !data) {
      console.error('[api/v1/conversation assignment] reload error:', error);
      return fail('internal', 'Conversation was assigned but could not be reloaded', 500);
    }

    return ok(serializeConversation(normalizeConversation(data as Conversation)));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
