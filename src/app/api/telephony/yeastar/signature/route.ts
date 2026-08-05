import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

import { decrypt } from '@/lib/whatsapp/encryption';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

type TokenResponse = { errcode: number; errmsg?: string; access_token?: string };
type SignResponse = { errcode: number; errmsg?: string; data?: { sign?: string } };

function admin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function POST() {
  try {
    const { accountId } = await requireRole('agent');
    const { data: config, error } = await admin()
      .from('telephony_configs')
      .select('pbx_url, extension, yeastar_access_id, yeastar_access_key')
      .eq('account_id', accountId)
      .eq('provider', 'yeastar')
      .maybeSingle();
    if (error) throw error;
    if (!config?.extension || !config.yeastar_access_id || !config.yeastar_access_key) {
      return NextResponse.json({ error: 'Yeastar is not configured.' }, { status: 409 });
    }
    const accessId = decrypt(config.yeastar_access_id);
    const accessKey = decrypt(config.yeastar_access_key);
    const tokenResponse = await fetch(`${config.pbx_url}/openapi/v1.0/get_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'wacrm-telephony/1.0' },
      body: JSON.stringify({ username: accessId, password: accessKey }),
      cache: 'no-store',
    });
    const token = (await tokenResponse.json()) as TokenResponse;
    if (!tokenResponse.ok || token.errcode !== 0 || !token.access_token) {
      return NextResponse.json({ error: token.errmsg || 'Yeastar authentication failed.' }, { status: 502 });
    }
    const expiresAt = Math.floor(Date.now() / 1000) + 300;
    const signResponse = await fetch(`${config.pbx_url}/openapi/v1.0/sign/create?access_token=${encodeURIComponent(token.access_token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'wacrm-telephony/1.0' },
      body: JSON.stringify({ username: config.extension, sign_type: 'sdk', expire_time: expiresAt }),
      cache: 'no-store',
    });
    const sign = (await signResponse.json()) as SignResponse;
    if (!signResponse.ok || sign.errcode !== 0 || !sign.data?.sign) {
      return NextResponse.json({ error: sign.errmsg || 'Could not create Linkus signature.' }, { status: 502 });
    }
    return NextResponse.json({ extension: config.extension, pbxUrl: config.pbx_url, secret: sign.data.sign, expiresAt });
  } catch (error) {
    return toErrorResponse(error);
  }
}
