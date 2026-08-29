import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

const STATUSES = ['pending', 'done', 'overdue', 'cancelled'] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; commitmentId: string }> }
) {
  try {
    const { supabase, accountId } = await requireRole('agent');
    const { id: contactId, commitmentId } = await params;
    const body = (await request.json().catch(() => null)) as {
      status?: unknown;
    } | null;
    const status =
      typeof body?.status === 'string' &&
      (STATUSES as readonly string[]).includes(body.status)
        ? body.status
        : null;
    if (!status)
      return NextResponse.json(
        { error: 'Estado de compromiso inválido.' },
        { status: 400 }
      );
    const { data, error } = await supabase
      .from('contact_commitments')
      .update({ status })
      .eq('id', commitmentId)
      .eq('contact_id', contactId)
      .eq('account_id', accountId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data)
      return NextResponse.json(
        { error: 'El compromiso no existe.' },
        { status: 404 }
      );
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
