'use client';

import { useEffect, useState } from 'react';
import { Bell, BellOff, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import { hasMinRole } from '@/lib/auth/roles';

type PushError = 'unsupported' | 'permissionDenied' | 'installFirst' | 'notConfigured' | 'requestFailed' | null;

function decodeApplicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const key = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index++) {
    key[index] = raw.charCodeAt(index);
  }
  return key;
}

export function WebPushSettings() {
  const t = useTranslations('Pwa');
  const { accountRole } = useAuth();
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PushError>(null);

  useEffect(() => {
    const available = process.env.NODE_ENV === 'production'
      && window.isSecureContext
      && 'serviceWorker' in navigator
      && 'PushManager' in window
      && 'Notification' in window;
    setSupported(available);

    if (!available) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    void navigator.serviceWorker.getRegistration('/')
      .then((registration) => registration?.pushManager.getSubscription() ?? null)
      .then((subscription) => {
        if (!cancelled) {
          setEnabled(Boolean(subscription) && Notification.permission === 'granted');
          setLoading(false);
        }
      })
      .catch((cause: unknown) => {
        console.error('[pwa] Could not inspect push subscription:', cause);
        if (!cancelled) {
          setError('requestFailed');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      const applicationServerKey = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY;
      if (!applicationServerKey) {
        setError('notConfigured');
        return;
      }
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

      const existingRegistration = await navigator.serviceWorker.getRegistration('/');
      const registration = existingRegistration
        ?? await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      const readyRegistration = registration.active ? registration : await navigator.serviceWorker.ready;
      const subscription = await readyRegistration.pushManager.getSubscription()
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
      setError('requestFailed');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
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

  const actionLabel = loading
    ? t('loading')
    : busy
      ? t(enabled ? 'disabling' : 'enabling')
      : t(enabled ? 'disablePush' : 'enablePush');

  if (!accountRole || !hasMinRole(accountRole, 'agent')) return null;

  return (
    <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
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
      {!supported && !loading ? (
        <p className="text-sm text-muted-foreground sm:basis-full">{t('unsupported')}</p>
      ) : null}
    </Card>
  );
}
