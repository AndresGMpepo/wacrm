import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { findExistingContact } from '@/lib/contacts/dedupe';

export const dynamic = 'force-dynamic';

/**
 * Manual creation for a scheduled follow-up task (contact_commitments with
 * a precise due_at) — the "Nueva tarea" dialog in the Seguimientos page and
 * the softphone's post-call prompt both post here. Complements the
 * AI-extracted commitments (src/lib/ai/memory.ts), which use the same
 * table, so both flows show up together in /call-tasks.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent');
    const body = (await request.json().catch(() => null)) as {
      contactId?: unknown;
      phone?: unknown;
      name?: unknown;
      description?: unknown;
      dueAt?: unknown;
    } | null;

    const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 300) : '';
    if (!description) {
      return NextResponse.json({ error: 'La descripción de la tarea es obligatoria.' }, { status: 400 });
    }
    const dueAt = typeof body?.dueAt === 'string' ? new Date(body.dueAt) : null;
    if (!dueAt || Number.isNaN(dueAt.getTime())) {
      return NextResponse.json({ error: 'La fecha y hora de la tarea no es válida.' }, { status: 400 });
    }

    const contactId = typeof body?.contactId === 'string' ? body.contactId : null;
    const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 200) || null : null;

    let resolvedContactId: string | null = null;
    if (contactId) {
      const { data: contact, error: contactError } = await supabase
        .from('contacts')
        .select('id')
        .eq('id', contactId)
        .eq('account_id', accountId)
        .maybeSingle();
      if (contactError) throw contactError;
      if (!contact) return NextResponse.json({ error: 'El contacto no existe.' }, { status: 404 });
      resolvedContactId = contact.id;
    } else if (phone) {
      const existing = await findExistingContact(supabase, accountId, phone);
      if (existing) {
        resolvedContactId = existing.id;
      } else {
        const { data: created, error: createError } = await supabase
          .from('contacts')
          .insert({ account_id: accountId, user_id: userId, phone, name })
          .select('id')
          .single();
        if (createError) throw createError;
        resolvedContactId = created.id;
      }
    } else {
      return NextResponse.json({ error: 'Indica un contacto o un número de teléfono.' }, { status: 400 });
    }

    const { data: task, error: insertError } = await supabase
      .from('contact_commitments')
      .insert({
        account_id: accountId,
        contact_id: resolvedContactId,
        description,
        owner: 'agent',
        due_date: dueAt.toISOString().slice(0, 10),
        due_at: dueAt.toISOString(),
        assigned_agent_id: userId,
        source_type: 'manual',
      })
      .select('id, contact_id, description, due_at')
      .single();
    if (insertError) throw insertError;

    return NextResponse.json({ task });
  } catch (error) {
    return toErrorResponse(error);
  }
}
