import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

import { decrypt } from '@/lib/whatsapp/encryption';
import { toErrorResponse } from '@/lib/auth/account';
import { requireEntitlement } from '@/lib/account/entitlements';

type TokenResponse = { errcode: number; errmsg?: string; access_token?: string };
type SignResponse = { errcode: number; errmsg?: string; data?: { sign?: string } };
type CachedCredential = { accessToken: string; accessExpiresAt: number; signature: string; signatureExpiresAt: number; extension: string; pbxUrl: string };
// A Linkus signature authenticates one extension. Never cache it at the
// account level or one member could receive another member's signature.
const credentialCache = new Map<string, CachedCredential>();

function admin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function POST() {
  try {
    const { accountId, userId } = await requireEntitlement('yeastar_telephony', 'agent');
    const [integration, userConfig] = await Promise.all([
      admin()
      .from('telephony_configs')
      .select('pbx_url, yeastar_access_id, yeastar_access_key')
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
    const config = integration.data;
    const extension = userConfig.data?.extension;
    if (!config?.pbx_url || !extension || !config.yeastar_access_id || !config.yeastar_access_key) {
      return NextResponse.json({ error: 'Configura tu extensión personal antes de conectar el softphone.' }, { status: 409 });
    }
    const cacheKey = `${accountId}:${userId}`;
    const cached = credentialCache.get(cacheKey);
    const now = Math.floor(Date.now() / 1000);
    if (cached && cached.extension === extension && cached.pbxUrl === config.pbx_url && cached.signatureExpiresAt > now + 30) {
      return NextResponse.json({ extension: cached.extension, pbxUrl: cached.pbxUrl, secret: cached.signature, expiresAt: cached.signatureExpiresAt });
    }
    const accessId = decrypt(config.yeastar_access_id);
    const accessKey = decrypt(config.yeastar_access_key);
    let accessToken = cached && cached.accessExpiresAt > now + 60 ? cached.accessToken : null;
    if (!accessToken) {
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
    accessToken = token.access_token;
    }
    const expiresAt = now + 240;
    const signResponse = await fetch(`${config.pbx_url}/openapi/v1.0/sign/create?access_token=${encodeURIComponent(accessToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'wacrm-telephony/1.0' },
      body: JSON.stringify({ username: extension, sign_type: 'sdk', expire_time: expiresAt }),
      cache: 'no-store',
    });
    const sign = (await signResponse.json()) as SignResponse;
    if (!signResponse.ok || sign.errcode !== 0 || !sign.data?.sign) {
      return NextResponse.json({ error: sign.errmsg || 'Could not create Linkus signature.' }, { status: 502 });
    }
    credentialCache.set(cacheKey, { accessToken, accessExpiresAt: now + 1500, signature: sign.data.sign, signatureExpiresAt: expiresAt, extension, pbxUrl: config.pbx_url });
    return NextResponse.json({ extension, pbxUrl: config.pbx_url, secret: sign.data.sign, expiresAt });
  } catch (error) {
    return toErrorResponse(error);
  }
}
