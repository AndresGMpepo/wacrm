import webpush from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';
import esMessages from '../../../messages/es.json';
import enMessages from '../../../messages/en.json';
import koMessages from '../../../messages/ko.json';
import { hasMinRole, isAccountRole } from '@/lib/auth/roles';
import { countAssignedUnreadMessages } from './unread-messages';

interface PushOutboxRow {
  id: string;
  notification_id: string;
  account_id: string;
  user_id: string;
  conversation_id: string;
  attempts: number;
}

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  locale: 'es' | 'en' | 'ko';
}

const pushCopy = {
  es: esMessages.Pwa,
  en: enMessages.Pwa,
  ko: koMessages.Pwa,
};

function getStatusCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return null;
  const statusCode = error.statusCode;
  return typeof statusCode === 'number' ? statusCode : null;
}

function vapidConfiguration() {
  const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    throw new Error('NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY, and WEB_PUSH_VAPID_SUBJECT are required.');
  }

  return { publicKey, privateKey, subject };
}

export async function processWebPushOutbox(db: SupabaseClient) {
  const now = new Date();
  const staleLock = new Date(now.getTime() - 5 * 60_000).toISOString();
  const { error: recoveryError } = await db
    .from('web_push_outbox')
    .update({ status: 'queued', locked_at: null })
    .eq('status', 'processing')
    .lt('locked_at', staleLock);
  if (recoveryError) {
    console.error('[web-push] Could not recover stale outbox items:', recoveryError);
    return { sent: 0, skipped: 0, failed: 1 };
  }

  const { data: pending, error: loadError } = await db
    .from('web_push_outbox')
    .select('id, notification_id, account_id, user_id, conversation_id, attempts')
    .eq('status', 'queued')
    .lte('next_attempt_at', now.toISOString())
    .order('created_at')
    .limit(5);
  if (loadError) {
    console.error('[web-push] Could not load outbox items:', loadError);
    return { sent: 0, skipped: 0, failed: 1 };
  }
  if (!pending?.length) return { sent: 0, skipped: 0, failed: 0 };

  let configuration: ReturnType<typeof vapidConfiguration>;
  try {
    configuration = vapidConfiguration();
    webpush.setVapidDetails(configuration.subject, configuration.publicKey, configuration.privateKey);
  } catch (error) {
    console.error('[web-push] Delivery is blocked by missing or invalid VAPID configuration:', error);
    return { sent: 0, skipped: 0, failed: pending.length };
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of pending as PushOutboxRow[]) {
    const attempt = item.attempts + 1;
    const { data: claimed, error: claimError } = await db
      .from('web_push_outbox')
      .update({
        status: 'processing',
        attempts: attempt,
        locked_at: new Date().toISOString(),
      })
      .eq('id', item.id)
      .eq('status', 'queued')
      .select('id')
      .maybeSingle();

    if (claimError) {
      console.error(`[web-push] Could not claim outbox item ${item.id}:`, claimError);
      failed++;
      continue;
    }
    if (!claimed) continue;

    const [
      { data: notification, error: notificationError },
      { data: subscriptions, error: subscriptionError },
      { data: conversation, error: conversationError },
      { data: profile, error: profileError },
    ] =
      await Promise.all([
        db.from('notifications')
          .select('id, conversation_id')
          .eq('id', item.notification_id)
          .eq('user_id', item.user_id)
          .eq('account_id', item.account_id)
          .maybeSingle(),
        db.from('web_push_subscriptions')
          .select('id, endpoint, p256dh, auth, locale')
          .eq('user_id', item.user_id)
          .eq('account_id', item.account_id)
          .limit(25),
        db.from('conversations')
          .select('assigned_agent_id')
          .eq('id', item.conversation_id)
          .eq('account_id', item.account_id)
          .maybeSingle(),
        db.from('profiles')
          .select('account_id, account_role')
          .eq('user_id', item.user_id)
          .eq('account_id', item.account_id)
          .maybeSingle(),
      ]);

    if (notificationError || subscriptionError || conversationError || profileError) {
      const cause = notificationError ?? subscriptionError ?? conversationError ?? profileError;
      console.error(`[web-push] Could not load delivery data for ${item.id}:`, cause);
      const errorMessage = notificationError?.message
        ?? subscriptionError?.message
        ?? conversationError?.message
        ?? profileError?.message
        ?? 'Could not load push delivery data.';
      await retryOutboxItem(db, item, attempt, errorMessage);
      failed++;
      continue;
    }

    const stillEligible = profile
      && profile.account_id === item.account_id
      && isAccountRole(profile.account_role)
      && hasMinRole(profile.account_role, 'agent')
      && conversation?.assigned_agent_id === item.user_id;
    if (!notification || !stillEligible || !subscriptions?.length) {
      if (!notification) {
        console.warn(`[web-push] Notification ${item.notification_id} no longer exists; skipping push.`);
      } else if (!stillEligible) {
        console.info(`[web-push] Assignment or role changed before notification ${item.notification_id} was sent.`);
      }
      const { error } = await db.from('web_push_outbox')
        .update({ status: 'sent', delivered_at: new Date().toISOString(), locked_at: null })
        .eq('id', item.id);
      if (error) {
        console.error(`[web-push] Could not complete empty delivery ${item.id}:`, error);
        failed++;
      } else {
        skipped++;
      }
      continue;
    }

    let unreadCount: number;
    try {
      unreadCount = await countAssignedUnreadMessages(db, item.account_id, item.user_id);
    } catch (error) {
      console.error(`[web-push] Could not count unread messages for ${item.id}:`, error);
      await retryOutboxItem(db, item, attempt, 'Could not count unread messages.');
      failed++;
      continue;
    }

    const outcomes = await Promise.all((subscriptions as PushSubscriptionRow[]).map(async (subscription) => {
      try {
        const copy = pushCopy[subscription.locale];
        const payload = JSON.stringify({
          title: copy.pushNotificationTitle,
          body: copy.pushNotificationBody,
          url: `/inbox?c=${encodeURIComponent(item.conversation_id)}`,
          tag: `nexoomni-${notification.id}`,
          unreadCount,
        });
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, payload, { TTL: 300, timeout: 8_000, urgency: 'high' });
        return { ok: true as const };
      } catch (error) {
        const statusCode = getStatusCode(error);
        if (statusCode === 404 || statusCode === 410) {
          const { error: deleteError } = await db.from('web_push_subscriptions')
            .delete()
            .eq('id', subscription.id);
          if (deleteError) {
            console.error(`[web-push] Could not remove expired subscription ${subscription.id}:`, deleteError);
          }
        } else {
          console.error(`[web-push] Delivery failed for subscription ${subscription.id}:`, error);
        }
        return { ok: false as const, error };
      }
    }));

    const delivered = outcomes.some((outcome) => outcome.ok);
    if (delivered) {
      const { error } = await db.from('web_push_outbox')
        .update({ status: 'sent', delivered_at: new Date().toISOString(), locked_at: null, last_error: null })
        .eq('id', item.id);
      if (error) {
        console.error(`[web-push] Could not mark outbox item ${item.id} as sent:`, error);
        failed++;
      } else {
        sent++;
        if (outcomes.some((outcome) => !outcome.ok)) {
          console.warn(`[web-push] Push reached some but not all subscriptions for outbox item ${item.id}.`);
        }
      }
      continue;
    }

    const lastError = outcomes
      .find((outcome) => !outcome.ok)?.error;
    await retryOutboxItem(
      db,
      item,
      attempt,
      lastError instanceof Error ? lastError.message.slice(0, 500) : 'Push provider rejected delivery.',
    );
    failed++;
  }

  return { sent, skipped, failed };
}

async function retryOutboxItem(
  db: SupabaseClient,
  item: PushOutboxRow,
  attempt: number,
  errorMessage: string,
) {
  const terminal = attempt >= 5;
  const nextAttempt = new Date(Date.now() + 60_000 * Math.min(attempt, 5)).toISOString();
  const { error } = await db.from('web_push_outbox')
    .update({
      status: terminal ? 'failed' : 'queued',
      next_attempt_at: nextAttempt,
      locked_at: null,
      last_error: errorMessage.slice(0, 500),
    })
    .eq('id', item.id);
  if (error) {
    console.error(`[web-push] Could not update failed outbox item ${item.id}:`, error);
  } else if (terminal) {
    console.error(`[web-push] Outbox item ${item.id} reached its retry limit: ${errorMessage}`);
  }
}
