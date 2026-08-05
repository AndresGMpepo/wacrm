import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

import { encrypt } from '@/lib/whatsapp/encryption';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

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
    const { accountId, userId } = await requireRole('agent');
    const [integration, userConfig] = await Promise.all([
      admin()
        .from('telephony_configs')
        .select('provider, pbx_url, sip_websocket_url, sip_username')
        .eq('account_id', accountId)
        .eq('provider', 'yeastar')
        .maybeSingle(),
      admin()
        .from('telephony_user_configs')
        .select('extension')
        .eq('account_id', accountId)
        .eq('user_id', userId)
        .eq('provider', 'yeastar')
        .maybeSingle(),
    ]);
    if (integration.error) throw integration.error;
    if (userConfig.error) throw userConfig.error;
    if (!integration.data) return NextResponse.json({ config: null });
    return NextResponse.json({
      config: {
        ...integration.data,
        extension: userConfig.data?.extension ?? null,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const { accountId, userId, role } = await requireRole('agent');
    const body = await request.json() as Record<string, unknown>;
    const extension = typeof body.extension === 'string' ? body.extension.trim() : '';
    if (!extension) return NextResponse.json({ error: 'La extensión es obligatoria.' }, { status: 400 });

    const existingResult = await admin()
      .from('telephony_configs')
      .select('pbx_url, yeastar_access_id, yeastar_access_key')
      .eq('account_id', accountId)
      .eq('provider', 'yeastar')
      .maybeSingle();
    if (existingResult.error) throw existingResult.error;
    const existing = existingResult.data;

    const isAdmin = role === 'owner' || role === 'admin';
    if (!existing && !isAdmin) {
      return NextResponse.json({ error: 'Un administrador debe configurar primero la integración Yeastar.' }, { status: 409 });
    }

    if (isAdmin && (body.pbxUrl || body.accessId || body.accessKey)) {
      const pbxUrl = validHttpsUrl(body.pbxUrl) ? body.pbxUrl.replace(/\/$/, '') : existing?.pbx_url;
      const accessId = typeof body.accessId === 'string' && body.accessId.trim() ? encrypt(body.accessId.trim()) : existing?.yeastar_access_id;
      const accessKey = typeof body.accessKey === 'string' && body.accessKey ? encrypt(body.accessKey) : existing?.yeastar_access_key;
      if (!pbxUrl || !accessId || !accessKey) {
        return NextResponse.json({ error: 'URL HTTPS, Access ID y Access Key son obligatorios para la primera conexión.' }, { status: 400 });
      }
      const { error } = await admin().from('telephony_configs').upsert({
        account_id: accountId,
        provider: 'yeastar',
        pbx_url: pbxUrl,
        // Extensions moved to telephony_user_configs. Clear the legacy value
        // so it can never be mistaken for an account-wide login again.
        extension: null,
        yeastar_access_id: accessId,
        yeastar_access_key: accessKey,
        created_by: userId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'account_id,provider' });
      if (error) throw error;
    }

    const { error: extensionError } = await admin().from('telephony_user_configs').upsert({
      account_id: accountId,
      user_id: userId,
      provider: 'yeastar',
      extension,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'account_id,user_id,provider' });
    if (extensionError) throw extensionError;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE() {
  try {
    const { accountId, userId } = await requireRole('agent');
    const { error } = await admin()
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
