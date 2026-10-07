import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { isAllowedWebPushEndpoint } from '@/lib/notifications/push-subscription';
import { sendDeviceTestPush } from '@/lib/notifications/web-push';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

const schema = z.object({
  endpoint: z.string().url().max(4096).refine(isAllowedWebPushEndpoint),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const limit = checkRateLimit(`push-test:${ctx.userId}`, RATE_LIMITS.broadcast);
    if (!limit.success) return rateLimitResponse(limit);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ code: 'requestFailed' }, { status: 400 });
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ code: 'requestFailed' }, { status: 400 });

    const { data: subscription, error } = await ctx.supabase.from('web_push_subscriptions')
      .select('id, endpoint, p256dh, auth, locale')
      .eq('account_id', ctx.accountId).eq('user_id', ctx.userId)
      .eq('endpoint', parsed.data.endpoint).maybeSingle();
    if (error) {
      console.error('[web-push] Could not load device test subscription:', error);
      return NextResponse.json({ code: 'requestFailed' }, { status: 500 });
    }
    if (!subscription) {
      return NextResponse.json({ code: 'subscriptionMissing' }, { status: 409 });
    }
    try {
      await sendDeviceTestPush(subscription);
    } catch (cause) {
      console.error('[web-push] Device test was rejected by the push provider:', cause);
      return NextResponse.json({ code: 'pushTestFailed' }, { status: 502 });
    }
    // Provider acceptance is not proof that the OS displayed a banner.
    return NextResponse.json({ accepted: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
