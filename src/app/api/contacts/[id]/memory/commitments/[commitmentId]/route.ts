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
      description?: unknown;
      dueAt?: unknown;
    } | null;

    const patch: Record<string, unknown> = {};

    if (body?.status !== undefined) {
      const status =
        typeof body.status === 'string' &&
        (STATUSES as readonly string[]).includes(body.status)
          ? body.status
          : null;
      if (!status)
        return NextResponse.json(
          { error: 'Estado de compromiso inválido.' },
          { status: 400 }
        );
      patch.status = status;
    }

    if (body?.description !== undefined) {
      const description = typeof body.description === 'string' ? body.description.trim().slice(0, 300) : '';
      if (!description)
        return NextResponse.json(
          { error: 'La descripción de la tarea es obligatoria.' },
          { status: 400 }
        );
      patch.description = description;
    }

    if (body?.dueAt !== undefined) {
      const dueAt = typeof body.dueAt === 'string' ? new Date(body.dueAt) : null;
      if (!dueAt || Number.isNaN(dueAt.getTime()))
        return NextResponse.json(
          { error: 'La fecha y hora de la tarea no es válida.' },
          { status: 400 }
        );
      patch.due_at = dueAt.toISOString();
      patch.due_date = dueAt.toISOString().slice(0, 10);
      // Editing the time resets the reminder so it fires again for the new due_at.
      patch.reminder_sent_at = null;
    }

    if (Object.keys(patch).length === 0)
      return NextResponse.json({ error: 'Nada para actualizar.' }, { status: 400 });

    const { data, error } = await supabase
      .from('contact_commitments')
      .update(patch)
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

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; commitmentId: string }> }
) {
  try {
    const { supabase, accountId } = await requireRole('agent');
    const { id: contactId, commitmentId } = await params;
    const { data, error } = await supabase
      .from('contact_commitments')
      .delete()
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

