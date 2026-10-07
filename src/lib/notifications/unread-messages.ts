import type { SupabaseClient } from '@supabase/supabase-js';

export async function countAssignedUnreadMessages(
  db: SupabaseClient,
  accountId: string,
  userId: string,
): Promise<number> {
  const pageSize = 500;
  let total = 0;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from('conversations')
      .select('unread_count')
      .eq('account_id', accountId)
      .eq('assigned_agent_id', userId)
      .gt('unread_count', 0)
      .order('id')
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!data) throw new Error('Unread message query returned no data.');
    total += data.reduce((sum, row) => sum + row.unread_count, 0);
    if (data.length < pageSize) return total;
  }
}
