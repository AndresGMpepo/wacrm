import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

import { encrypt } from '@/lib/whatsapp/encryption';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

type SavedConfig = {
  provider: 'yeastar' | 'sip';
  pbx_url: string;
  extension: string | null;
  sip_websocket_url: string | null;
  sip_username: string | null;
};

function admin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

function validHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export async function GET() {
  try {
    const { accountId } = await requireRole('agent');
    const { data, error } = await admin()
      .from('telephony_configs')
      .select('provider, pbx_url, extension, sip_websocket_url, sip_username')
      .eq('account_id', accountId)
      .eq('provider', 'yeastar')
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({ config: (data as SavedConfig | null) ?? null });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin');
    const body = await request.json();
    const { pbxUrl, accessId, accessKey, extension } = body as Record<string, unknown>;
    if (!validHttpsUrl(pbxUrl) || typeof extension !== 'string' || !extension.trim()) {
      return NextResponse.json({ error: 'PBX URL HTTPS and extension are required.' }, { status: 400 });
    }
    const { data: existing, error: existingError } = await admin().from('telephony_configs').select('yeastar_access_id, yeastar_access_key').eq('account_id', accountId).eq('provider', 'yeastar').maybeSingle();
    if (existingError) throw existingError;
    const nextAccessId = typeof accessId === 'string' && accessId.trim() ? encrypt(accessId.trim()) : existing?.yeastar_access_id;
    const nextAccessKey = typeof accessKey === 'string' && accessKey ? encrypt(accessKey) : existing?.yeastar_access_key;
    if (!nextAccessId || !nextAccessKey) return NextResponse.json({ error: 'Linkus SDK Access ID and Access Key are required.' }, { status: 400 });
    const { error } = await admin().from('telephony_configs').upsert(
      {
        account_id: accountId,
        provider: 'yeastar',
        pbx_url: pbxUrl.replace(/\/$/, ''),
        extension: extension.trim(),
        yeastar_access_id: nextAccessId,
        yeastar_access_key: nextAccessKey,
        created_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id,provider' },
    );
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE() {
  try {
    const { accountId } = await requireRole('admin');
    const { error } = await admin().from('telephony_configs').delete().eq('account_id', accountId).eq('provider', 'yeastar');
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
