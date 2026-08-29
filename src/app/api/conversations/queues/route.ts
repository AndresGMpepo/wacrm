import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

/**
 * Specialized conversation queues (e.g. "Soporte", "Ventas"). An account
 * always has exactly one `is_default` queue ("General") that mirrors the
 * pre-existing whole-account auto-assignment behavior when it has no
 * explicit members.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer');
    const [queuesResult, membersResult, agentsResult, connectorsResult, whatsappResult] = await Promise.all([
      supabase.from('conversation_queues').select('id, name, is_default, mode').eq('account_id', accountId).order('is_default', { ascending: false }).order('name'),
      supabase.from('conversation_queue_members').select('queue_id, user_id'),
      supabase.from('profiles').select('user_id, full_name').eq('account_id', accountId).eq('is_active', true).in('account_role', ['owner', 'admin', 'agent']).order('full_name'),
      supabase.from('omnichannel_connectors').select('id, provider, display_name, queue_id').eq('account_id', accountId).order('display_name'),
      supabase.from('whatsapp_config').select('id, phone_number_id, queue_id').eq('account_id', accountId).maybeSingle(),
    ]);
    if (queuesResult.error) throw queuesResult.error;
    if (membersResult.error) throw membersResult.error;
    if (agentsResult.error) throw agentsResult.error;
    if (connectorsResult.error) throw connectorsResult.error;
    if (whatsappResult.error) throw whatsappResult.error;

    const membersByQueue = new Map<string, string[]>();
    for (const row of membersResult.data ?? []) {
      const list = membersByQueue.get(row.queue_id) ?? [];
      list.push(row.user_id);
      membersByQueue.set(row.queue_id, list);
    }

    const sources = [
      ...(whatsappResult.data
        ? [{ key: 'whatsapp', label: whatsappResult.data.phone_number_id ? `WhatsApp · ${whatsappResult.data.phone_number_id}` : 'WhatsApp', channel: 'whatsapp', queue_id: whatsappResult.data.queue_id }]
        : []),
      ...(connectorsResult.data ?? []).map((connector) => ({
        key: `connector:${connector.id}`,
        label: connector.display_name,
        channel: connector.provider,
        queue_id: connector.queue_id,
      })),
    ];

    return NextResponse.json({
      queues: (queuesResult.data ?? []).map((queue) => ({ ...queue, member_ids: membersByQueue.get(queue.id) ?? [] })),
      agents: agentsResult.data ?? [],
      sources,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const body = (await request.json().catch(() => null)) as { name?: unknown; mode?: unknown } | null;
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : '';
    if (!name) return NextResponse.json({ error: 'Indica un nombre para la cola.' }, { status: 400 });
    const mode = body?.mode === 'least_open' ? 'least_open' : 'round_robin';
    const { data, error } = await supabase.from('conversation_queues').insert({ account_id: accountId, name, mode }).select('id, name, is_default, mode').single();
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: 'Ya existe una cola con ese nombre.' }, { status: 400 });
      throw error;
    }
    return NextResponse.json({ queue: { ...data, member_ids: [] } }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const body = (await request.json().catch(() => null)) as { id?: unknown; name?: unknown; mode?: unknown; member_ids?: unknown } | null;
    const id = typeof body?.id === 'string' ? body.id : '';
    if (!id) return NextResponse.json({ error: 'Cola inválida.' }, { status: 400 });
    const update: Record<string, unknown> = {};
    if (typeof body?.name === 'string' && body.name.trim()) update.name = body.name.trim().slice(0, 80);
    if (body?.mode === 'round_robin' || body?.mode === 'least_open') update.mode = body.mode;
    if (Object.keys(update).length) {
      const { error } = await supabase.from('conversation_queues').update(update).eq('id', id).eq('account_id', accountId);
      if (error) {
        if (error.code === '23505') return NextResponse.json({ error: 'Ya existe una cola con ese nombre.' }, { status: 400 });
        throw error;
      }
    }
    if (Array.isArray(body?.member_ids)) {
      const memberIds = body.member_ids.filter((value): value is string => typeof value === 'string');
      const { error: deleteError } = await supabase.from('conversation_queue_members').delete().eq('queue_id', id);
      if (deleteError) throw deleteError;
      if (memberIds.length) {
        const { error: insertError } = await supabase.from('conversation_queue_members').insert(memberIds.map((userId) => ({ queue_id: id, user_id: userId })));
        if (insertError) throw insertError;
      }
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const url = new URL(request.url);
    const id = url.searchParams.get('id') || '';
    if (!id) return NextResponse.json({ error: 'Cola inválida.' }, { status: 400 });
    const { data: queue, error: queueError } = await supabase.from('conversation_queues').select('is_default').eq('id', id).eq('account_id', accountId).maybeSingle();
    if (queueError) throw queueError;
    if (!queue) return NextResponse.json({ error: 'La cola no existe.' }, { status: 404 });
    if (queue.is_default) return NextResponse.json({ error: 'No puedes eliminar la cola General.' }, { status: 400 });
    const { error } = await supabase.from('conversation_queues').delete().eq('id', id).eq('account_id', accountId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
