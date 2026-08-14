// ============================================================
// POST /api/v1/conversations/{id}/internal-notes
//
// Creates a private team note. It is stored in the existing internal-note
// table only; it never enters WhatsApp, Yeastar or any customer channel.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { resolveAuditUserId, ContactError } from '@/lib/api/v1/contacts';
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'conversation-notes:write');
    const { id } = await params;
    const payload = await request.json().catch(() => null);
    const body = typeof payload?.body === 'string' ? payload.body.trim() : '';

    if (!body || body.length > 2000) {
      return fail('bad_request', "'body' must contain between 1 and 2000 characters", 400);
    }

    const { data: conversation, error: conversationError } = await ctx.supabase
      .from('conversations')
      .select('id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (conversationError) {
      console.error('[api/v1/internal notes] conversation read error:', conversationError);
      return fail('internal', 'Failed to read conversation', 500);
    }
    if (!conversation) return fail('not_found', 'Conversation not found', 404);

    const authorUserId = await resolveAuditUserId(ctx.supabase, ctx.accountId);
    const { data, error } = await ctx.supabase
      .from('conversation_internal_notes')
      .insert({
        account_id: ctx.accountId,
        conversation_id: id,
        author_user_id: authorUserId,
        body,
        kind: 'note',
      })
      .select('id, conversation_id, body, kind, created_at')
      .single();
    if (error || !data) {
      console.error('[api/v1/internal notes] insert error:', error);
      return fail('internal', 'Failed to create internal note', 500);
    }

    // The attributed account owner/config owner has already seen this note.
    // Other human team members retain their normal unread indicator.
    await ctx.supabase.from('conversation_internal_note_reads').upsert({
      account_id: ctx.accountId,
      conversation_id: id,
      user_id: authorUserId,
      read_at: new Date().toISOString(),
    });

    return ok(data, 201);
  } catch (err) {
    if (err instanceof ContactError) {
      return fail('internal', err.message, err.status);
    }
    return toApiErrorResponse(err);
  }
}
