import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { isAllowedWebPushEndpoint } from '@/lib/notifications/push-subscription';
import { vapidConfiguration } from '@/lib/notifications/web-push';

const endpointSchema = z.string().url().max(4096).refine(isAllowedWebPushEndpoint);
const subscriptionSchema = z.object({
  endpoint: endpointSchema,
  expirationTime: z.number().int().positive().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(16).max(256).regex(/^[A-Za-z0-9_-]+$/),
    auth: z.string().min(16).max(256).regex(/^[A-Za-z0-9_-]+$/),
  }),
  locale: z.enum(['es', 'en', 'ko']).optional(),
});

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('agent');
    let configuration: ReturnType<typeof vapidConfiguration>;
    try {
      configuration = vapidConfiguration();
    } catch (error) {
      console.error('[web-push] Push configuration is unavailable:', error);
      return NextResponse.json({ code: 'notConfigured' }, { status: 503 });
    }
    const endpoint = new URL(request.url).searchParams.get('endpoint');
    let registered = false;
    if (endpoint) {
      if (!endpointSchema.safeParse(endpoint).success) {
        return NextResponse.json({ code: 'requestFailed' }, { status: 400 });
      }
      const { data, error } = await ctx.supabase.from('web_push_subscriptions')
        .select('id').eq('endpoint', endpoint)
        .eq('account_id', ctx.accountId).eq('user_id', ctx.userId).maybeSingle();
      if (error) {
        console.error('[web-push] Could not verify saved subscription:', error);
        return NextResponse.json({ code: 'requestFailed' }, { status: 500 });
      }
      registered = Boolean(data);
    }
    return NextResponse.json({ publicKey: configuration.publicKey, registered }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const parsed = subscriptionSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid push subscription.' }, { status: 400 });
    }

    const subscription = parsed.data;
    const { data: existing, error: existingError } = await ctx.supabase
      .from('web_push_subscriptions')
      .select('id')
      .eq('endpoint', subscription.endpoint)
      .maybeSingle();
    if (existingError) {
      console.error('[web-push] Could not check existing subscription:', existingError);
      return NextResponse.json({ error: 'Could not save push subscription.' }, { status: 500 });
    }
    if (!existing) {
      const { count, error: countError } = await ctx.supabase
        .from('web_push_subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', ctx.userId);
      if (countError) {
        console.error('[web-push] Could not count active subscriptions:', countError);
        return NextResponse.json({ error: 'Could not save push subscription.' }, { status: 500 });
      }
      if ((count ?? 0) >= 5) {
        return NextResponse.json({ error: 'This user has reached the browser subscription limit.' }, { status: 409 });
      }
    }

    const { error } = await ctx.supabase
      .from('web_push_subscriptions')
      .upsert({
        account_id: ctx.accountId,
        user_id: ctx.userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        locale: subscription.locale ?? 'es',
        expiration_time: subscription.expirationTime
          ? new Date(subscription.expirationTime).toISOString()
          : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'endpoint' });

    if (error) {
      console.error('[web-push] Could not save subscription:', error);
      if (error.code === '23505') {
        return NextResponse.json({ error: 'This browser is registered to another user.' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Could not save push subscription.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = await readJson(request);
    const endpoint = endpointSchema.safeParse(
      typeof body === 'object' && body !== null && 'endpoint' in body
        ? body.endpoint
        : null,
    );
    if (!endpoint.success) {
      return NextResponse.json({ error: 'Invalid push endpoint.' }, { status: 400 });
    }

    const { error } = await ctx.supabase
      .from('web_push_subscriptions')
      .delete()
      .eq('account_id', ctx.accountId)
      .eq('user_id', ctx.userId)
      .eq('endpoint', endpoint.data);
    if (error) {
      console.error('[web-push] Could not delete subscription:', error);
      return NextResponse.json({ error: 'Could not remove push subscription.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
