import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

/** Sets which queue a channel connection (WhatsApp number, or an
 *  omnichannel connector) routes its NEW conversations into. */
export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const body = (await request.json().catch(() => null)) as { key?: unknown; queue_id?: unknown } | null;
    const key = typeof body?.key === 'string' ? body.key : '';
    const queueId = typeof body?.queue_id === 'string' ? body.queue_id : null;
    if (!key) return NextResponse.json({ error: 'Origen inválido.' }, { status: 400 });

    if (queueId) {
      const { data: queue, error: queueError } = await supabase.from('conversation_queues').select('id').eq('id', queueId).eq('account_id', accountId).maybeSingle();
      if (queueError) throw queueError;
      if (!queue) return NextResponse.json({ error: 'Esa cola no existe en esta cuenta.' }, { status: 400 });
    }

    if (key === 'whatsapp') {
      const { error } = await supabase.from('whatsapp_config').update({ queue_id: queueId }).eq('account_id', accountId);
      if (error) throw error;
    } else if (key.startsWith('connector:')) {
      const connectorId = key.slice('connector:'.length);
      const { error } = await supabase.from('omnichannel_connectors').update({ queue_id: queueId }).eq('id', connectorId).eq('account_id', accountId);
      if (error) throw error;
    } else {
      return NextResponse.json({ error: 'Origen inválido.' }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
