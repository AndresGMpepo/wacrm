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

export function vapidConfiguration() {
  // Read at runtime: Docker does not bake VAPID values into the client bundle.
  const {
    NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY: publicKey,
    WEB_PUSH_VAPID_PRIVATE_KEY: privateKey,
    WEB_PUSH_VAPID_SUBJECT: subject,
  } = process.env;

  if (!publicKey || !privateKey || !subject) {
    throw new Error('NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY, and WEB_PUSH_VAPID_SUBJECT are required.');
  }

  return { publicKey, privateKey, subject };
}

export async function sendDeviceTestPush(subscription: PushSubscriptionRow) {
  const configuration = vapidConfiguration();
  const copy = pushCopy[subscription.locale];
  await webpush.sendNotification({
    endpoint: subscription.endpoint,
    keys: { p256dh: subscription.p256dh, auth: subscription.auth },
  }, JSON.stringify({
    title: copy.pushNotificationTitle,
    body: copy.pushTestBody,
    url: '/notifications',
    tag: `nexoomni-test-${Date.now()}`,
  }), {
    TTL: 300, timeout: 8_000, urgency: 'high',
    vapidDetails: configuration,
  });
}

const PUSH_MAX_AGE_MS = 15 * 60_000;

interface RingingExtension {
  extension: string;
  callerNumber: string | null;
  callerName: string | null;
}

/**
 * Sends an immediate call alert (no outbox/worker: a ringing call is only
 * relevant for seconds) to every registered device of the agent who owns each
 * ringing Yeastar extension. Uses the same per-extension tag as the in-page
 * alert so a device that has both shows a single entry.
 */
export async function sendIncomingCallPush(
  db: SupabaseClient, accountId: string, ringing: RingingExtension[],
) {
  if (!ringing.length) return { sent: 0, failed: 0 };
  let configuration: ReturnType<typeof vapidConfiguration>;
  try {
    configuration = vapidConfiguration();
  } catch (error) {
    console.error('[web-push] Call alert blocked by missing or invalid VAPID configuration:', error);
    return { sent: 0, failed: ringing.length };
  }

  const { data: owners, error: ownerError } = await db.from('telephony_user_configs')
    .select('user_id, extension')
    .eq('account_id', accountId)
    .eq('provider', 'yeastar')
    .in('extension', ringing.map((item) => item.extension));
  if (ownerError) throw ownerError;
  const ownerIds = [...new Set((owners ?? []).map((row) => row.user_id as string))];
  if (!ownerIds.length) return { sent: 0, failed: 0 };

  const [{ data: profiles, error: profileError }, { data: subscriptions, error: subscriptionError }] = await Promise.all([
    db.from('profiles').select('user_id, account_role')
      .eq('account_id', accountId).in('user_id', ownerIds),
    db.from('web_push_subscriptions').select('id, user_id, endpoint, p256dh, auth, locale')
      .eq('account_id', accountId).in('user_id', ownerIds),
  ]);
  if (profileError) throw profileError;
  if (subscriptionError) throw subscriptionError;

  const agents = new Set((profiles ?? [])
    .filter((row) => isAccountRole(row.account_role) && hasMinRole(row.account_role, 'agent'))
    .map((row) => row.user_id as string));
  const ringingAt = Date.now();
  let sent = 0;
  let failed = 0;

  await Promise.all((owners ?? []).flatMap((owner) => {
    if (!agents.has(owner.user_id)) return [];
    const call = ringing.find((item) => item.extension === owner.extension);
    if (!call) return [];
    return ((subscriptions ?? []) as (PushSubscriptionRow & { user_id: string })[])
      .filter((subscription) => subscription.user_id === owner.user_id)
      .map(async (subscription) => {
        const copy = pushCopy[subscription.locale] ?? pushCopy.es;
        const caller = call.callerName ?? call.callerNumber ?? copy.unknownCaller;
        try {
          await webpush.sendNotification({
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          }, JSON.stringify({
            kind: 'call',
            title: copy.incomingCallTitle,
            body: copy.incomingCallBody.replace('{caller}', caller),
            url: '/inbox',
            tag: `nexoomni-call-${owner.extension}`,
            ringingAt,
          }), { TTL: 30, timeout: 5_000, urgency: 'high', vapidDetails: configuration });
          sent++;
        } catch (error) {
          failed++;
          const statusCode = getStatusCode(error);
          if (statusCode === 404 || statusCode === 410) {
            await db.from('web_push_subscriptions').delete().eq('id', subscription.id);
          } else {
            console.error(`[web-push] Call alert failed for subscription ${subscription.id}:`, error);
          }
        }
      });
  }));
  return { sent, failed };
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

  // A message alert is only useful while it is current. Without this, a backlog built while
  // delivery was blocked (e.g. missing VAPID keys) would replay old alerts and delay new ones.
  const { error: expiryError } = await db
    .from('web_push_outbox')
    .update({ status: 'failed', locked_at: null, last_error: 'expired' })
    .eq('status', 'queued')
    .lt('created_at', new Date(now.getTime() - PUSH_MAX_AGE_MS).toISOString());
  if (expiryError) {
    console.error('[web-push] Could not expire old outbox items:', expiryError);
  }

  const { data: pending, error: loadError } = await db
    .from('web_push_outbox')
    .select('id, notification_id, account_id, user_id, conversation_id, attempts')
    .eq('status', 'queued')
    .lte('next_attempt_at', now.toISOString())
    .order('created_at')
    .limit(25);
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

    // Mirrors enqueue_assigned_message_web_push() (migration 144): an
    // assigned conversation pushes only to its assignee, an unassigned one
    // (the usual state of a new Facebook/Instagram DM) pushes to everyone
    // notify_incoming_message() notified. Requiring an exact assignee match
    // here silently dropped every unassigned FB/IG push as "sent".
    const stillEligible = profile
      && profile.account_id === item.account_id
      && isAccountRole(profile.account_role)
      && hasMinRole(profile.account_role, 'agent')
      && conversation
      && (conversation.assigned_agent_id == null || conversation.assigned_agent_id === item.user_id);
    if (!notification || !stillEligible || !subscriptions?.length) {
      if (!notification) {
        console.warn(`[web-push] Notification ${item.notification_id} no longer exists; skipping push.`);
      } else if (!stillEligible) {
        console.info(`[web-push] Assignment or role changed before notification ${item.notification_id} was sent.`);
      } else {
        console.info(`[web-push] User ${item.user_id} has no registered push devices; skipping notification ${item.notification_id}.`);
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
