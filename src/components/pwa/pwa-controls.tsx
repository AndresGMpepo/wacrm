'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
  interface Window {
    __nexoomniInstallPrompt?: BeforeInstallPromptEvent;
  }
}

export function PwaServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !window.isSecureContext || !('serviceWorker' in navigator)) return;

    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      window.__nexoomniInstallPrompt = event as BeforeInstallPromptEvent;
      window.dispatchEvent(new Event('nexoomni:pwa-install-prompt'));
    };
    const clearInstallPrompt = () => {
      window.__nexoomniInstallPrompt = undefined;
      window.dispatchEvent(new Event('nexoomni:pwa-installed'));
    };
    let hadController = Boolean(navigator.serviceWorker.controller);
    const handleControllerChange = () => {
      if (hadController) window.dispatchEvent(new Event('nexoomni:pwa-update-ready'));
      hadController = true;
    };

    window.addEventListener('beforeinstallprompt', captureInstallPrompt);
    window.addEventListener('appinstalled', clearInstallPrompt);
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
    void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch((error: unknown) => {
        console.error('[pwa] Service worker registration failed:', error);
      });
    return () => {
      window.removeEventListener('beforeinstallprompt', captureInstallPrompt);
      window.removeEventListener('appinstalled', clearInstallPrompt);
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
  }, []);

  return null;
}

export function PwaInstallControl() {
  const t = useTranslations('Pwa');
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installFailed, setInstallFailed] = useState(false);

  useEffect(() => {
    const userAgent = window.navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || ('standalone' in navigator && navigator.standalone === true);

    setIsIos(ios);
    setIsInstalled(standalone);

    const updateInstallPrompt = () => {
      setInstallPrompt(window.__nexoomniInstallPrompt ?? null);
    };
    const handleInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
    };

    updateInstallPrompt();
    window.addEventListener('nexoomni:pwa-install-prompt', updateInstallPrompt);
    window.addEventListener('nexoomni:pwa-installed', handleInstalled);
    return () => {
      window.removeEventListener('nexoomni:pwa-install-prompt', updateInstallPrompt);
      window.removeEventListener('nexoomni:pwa-installed', handleInstalled);
    };
  }, []);

  const install = async () => {
    if (isIos) {
      setShowIosHelp((visible) => !visible);
      return;
    }
    if (!installPrompt) return;

    setIsInstalling(true);
    setInstallFailed(false);
    try {
      await installPrompt.prompt();
      const result = await installPrompt.userChoice;
      if (result.outcome === 'accepted') setIsInstalled(true);
      setInstallPrompt(null);
    } catch (error) {
      console.error('[pwa] Installation prompt failed:', error);
      setInstallFailed(true);
    } finally {
      setIsInstalling(false);
    }
  };

  if (isInstalled || (!isIos && !installPrompt)) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void install()}
        disabled={isInstalling}
        aria-expanded={isIos ? showIosHelp : undefined}
        aria-label={t('installApp')}
        title={t('installApp')}
        className="flex h-9 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:px-3 sm:text-sm"
      >
        <Download className="size-4 shrink-0" />
        <span className="hidden sm:inline">{t('installApp')}</span>
      </button>
      {isIos && showIosHelp ? (
        <p
          role="status"
          className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
        >
          {t('iosInstallHelp')}
        </p>
      ) : null}
      {installFailed ? (
        <p role="alert" className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg">
          {t('installFailed')}
        </p>
      ) : null}
    </div>
  );
}

export function PwaUpdatePrompt() {
  const t = useTranslations('Pwa');
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const showUpdate = () => setAvailable(true);
    window.addEventListener('nexoomni:pwa-update-ready', showUpdate);
    return () => window.removeEventListener('nexoomni:pwa-update-ready', showUpdate);
  }, []);

  if (!available) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-[100] mx-auto flex max-w-lg items-center justify-between gap-4 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl">
      <p className="text-sm">{t('updateReady')}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="shrink-0 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
      >
        {t('updateNow')}
      </button>
    </div>
  );
}
