'use client';

import { useEffect, useState } from 'react';
import { Bell, BellOff, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import { hasMinRole } from '@/lib/auth/roles';
import {
  decodeApplicationServerKey, getDevicePushConfiguration, PushSettingsError,
  subscriptionKeyMatches, type PushErrorCode,
} from '@/lib/notifications/push-client';

export function WebPushSettings() {
  const t = useTranslations('Pwa');
  const { accountRole, user, accountId } = useAuth();
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PushErrorCode | null>(null);
  const [testAccepted, setTestAccepted] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const available = process.env.NODE_ENV === 'production'
      && window.isSecureContext
      && 'serviceWorker' in navigator
      && 'PushManager' in window
      && 'Notification' in window;
    setSupported(available);

    if (!available || !accountRole || !hasMinRole(accountRole, 'agent')) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void navigator.serviceWorker.getRegistration('/')
      .then((registration) => registration?.pushManager.getSubscription() ?? null)
      .then(async (subscription) => {
        const configuration = await getDevicePushConfiguration(subscription?.endpoint);
        if (!cancelled) {
          const matches = !subscription || subscriptionKeyMatches(subscription, configuration.publicKey);
          setEnabled(Boolean(subscription) && configuration.registered
            && matches && Notification.permission === 'granted');
          setError(subscription && !configuration.registered ? 'subscriptionMissing'
            : !matches ? 'subscriptionKeyChanged'
              : Notification.permission === 'denied' ? 'permissionDenied' : null);
          setLoading(false);
        }
      })
      .catch((cause: unknown) => {
        console.error('[pwa] Could not inspect push subscription:', cause);
        if (!cancelled) {
          setError(cause instanceof PushSettingsError ? cause.code : 'requestFailed');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accountRole, user, accountId]);

  const enable = async () => {
    setBusy(true);
    setError(null);
    setTestAccepted(false);
    try {
      if (!supported) {
        setError('unsupported');
        return;
      }
      const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches
        || ('standalone' in navigator && navigator.standalone === true);
      if (isIos && !isStandalone) {
        setError('installFirst');
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setError('permissionDenied');
        return;
      }
      const { publicKey: applicationServerKey } = await getDevicePushConfiguration();

      const existingRegistration = await navigator.serviceWorker.getRegistration('/');
      const registration = existingRegistration
        ?? await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      const readyRegistration = registration.active ? registration : await navigator.serviceWorker.ready;
      let existingSubscription = await readyRegistration.pushManager.getSubscription();
      if (existingSubscription && !subscriptionKeyMatches(existingSubscription, applicationServerKey)) {
        const removed = await fetch('/api/push/subscription', {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: existingSubscription.endpoint }),
        });
        if (!removed.ok || !await existingSubscription.unsubscribe()) {
          throw new PushSettingsError('requestFailed');
        }
        existingSubscription = null;
      }
      const subscription = existingSubscription
        ?? await readyRegistration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeApplicationServerKey(applicationServerKey),
        });
      const response = await fetch('/api/push/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...subscription.toJSON(),
          locale: document.documentElement.lang.split('-')[0],
        }),
      });
      if (!response.ok) throw new Error(`Subscription request failed: ${response.status}`);
      setEnabled(true);
    } catch (cause) {
      console.error('[pwa] Could not enable push notifications:', cause);
      setError(cause instanceof PushSettingsError ? cause.code : 'requestFailed');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    setTestAccepted(false);
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const response = await fetch('/api/push/subscription', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        if (!response.ok) throw new Error(`Subscription removal failed: ${response.status}`);
        const unsubscribed = await subscription.unsubscribe();
        if (!unsubscribed) throw new Error('Browser rejected subscription removal.');
      }
      setEnabled(false);
    } catch (cause) {
      console.error('[pwa] Could not disable push notifications:', cause);
      setError('requestFailed');
    } finally {
      setBusy(false);
    }
  };

  const testPush = async () => {
    setBusy(true);
    setTesting(true);
    setError(null);
    setTestAccepted(false);
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) throw new PushSettingsError('subscriptionMissing');
      const configuration = await getDevicePushConfiguration(subscription.endpoint);
      if (!configuration.registered) throw new PushSettingsError('subscriptionMissing');
      if (!subscriptionKeyMatches(subscription, configuration.publicKey)) {
        throw new PushSettingsError('subscriptionKeyChanged');
      }
      const response = await fetch('/api/push/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const code = typeof result === 'object' && result !== null && 'code' in result
          ? result.code : null;
        throw new PushSettingsError(code === 'subscriptionMissing' ? code
          : code === 'pushTestFailed' ? code : 'requestFailed');
      }
      if (typeof result !== 'object' || result === null || !('accepted' in result) || result.accepted !== true) {
        throw new PushSettingsError('requestFailed');
      }
      setTestAccepted(true);
    } catch (cause) {
      console.error('[pwa] Device push test failed:', cause);
      setError(cause instanceof PushSettingsError ? cause.code : 'requestFailed');
      if (cause instanceof PushSettingsError
        && (cause.code === 'subscriptionMissing' || cause.code === 'subscriptionKeyChanged')) {
        setEnabled(false);
      }
    } finally {
      setTesting(false);
      setBusy(false);
    }
  };

  const actionLabel = loading
    ? t('loading')
    : busy
      ? t(testing ? 'testingPush' : enabled ? 'disabling' : 'enabling')
      : t(enabled ? 'disablePush' : 'enablePush');

  if (!accountRole || !hasMinRole(accountRole, 'agent')) return null;

  return (
    <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
          {enabled ? <Bell className="size-5" /> : <BellOff className="size-5" />}
        </span>
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t('pushTitle')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(enabled ? 'pushEnabledDescription' : 'pushDescription')}
          </p>
          {error ? (
            <p role="alert" className="mt-2 text-sm text-destructive">{t(error)}</p>
          ) : null}
          {testAccepted ? <p role="status" className="mt-2 text-sm text-muted-foreground">{t('pushTestAccepted')}</p> : null}
        </div>
      </div>
      <button
        type="button"
        disabled={loading || busy || !supported}
        onClick={() => void (enabled ? disable() : enable())}
        className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading || busy ? <Loader2 className="size-4 animate-spin" /> : null}
        {actionLabel}
      </button>
      {enabled ? (
        <button type="button" disabled={loading || busy} onClick={() => void testPush()}
          className="inline-flex min-h-10 items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">
          {t('testPush')}
        </button>
      ) : null}
      {!supported && !loading ? (
        <p className="text-sm text-muted-foreground sm:basis-full">{t('unsupported')}</p>
      ) : null}
    </Card>
  );
}
