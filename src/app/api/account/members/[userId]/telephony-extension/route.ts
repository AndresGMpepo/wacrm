// ============================================================
// PATCH /api/account/members/[userId]/telephony-extension
//
// Lets an admin/owner assign a teammate's NexPhone (Yeastar) softphone
// extension directly from Settings → Miembros, instead of the agent
// self-configuring it under Settings → Telefonía. Reuses the account's
// already-saved PBX URL/Access ID/Access Key (telephony_configs) — the
// admin only ever types the extension number.
//
// Gated by the same 'yeastar_telephony' plan entitlement as the rest of
// the telephony module (src/lib/account/entitlements.ts).
// ============================================================

import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

import { requireEntitlement } from '@/lib/account/entitlements';
import { toErrorResponse } from '@/lib/auth/account';

function admin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const { accountId } = await requireEntitlement('yeastar_telephony', 'admin');
    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as { extension?: unknown } | null;
    const extension = typeof body?.extension === 'string' ? body.extension.trim() : '';
    if (!extension) return NextResponse.json({ error: 'La extensión es obligatoria.' }, { status: 400 });

    const db = admin();

    const { data: targetProfile, error: profileError } = await db
      .from('profiles')
      .select('account_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!targetProfile || targetProfile.account_id !== accountId) {
      return NextResponse.json({ error: 'Ese usuario no pertenece a tu cuenta.' }, { status: 404 });
    }

    const { data: integration, error: integrationError } = await db
      .from('telephony_configs')
      .select('pbx_url')
      .eq('account_id', accountId)
      .eq('provider', 'yeastar')
      .maybeSingle();
    if (integrationError) throw integrationError;
    if (!integration) {
      return NextResponse.json(
        { error: 'Configura primero la integración Yeastar en Configuración → Telefonía (URL, Access ID y Access Key).' },
        { status: 409 },
      );
    }

    const { error: upsertError } = await db.from('telephony_user_configs').upsert({
      account_id: accountId,
      user_id: userId,
      provider: 'yeastar',
      extension,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'account_id,user_id,provider' });
    if (upsertError) throw upsertError;

    return NextResponse.json({ ok: true, extension });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const { accountId } = await requireEntitlement('yeastar_telephony', 'admin');
    const { userId } = await params;
    const db = admin();
    const { error } = await db
      .from('telephony_user_configs')
      .delete()
      .eq('account_id', accountId)
      .eq('user_id', userId)
      .eq('provider', 'yeastar');
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
