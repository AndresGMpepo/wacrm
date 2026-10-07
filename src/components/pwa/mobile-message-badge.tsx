'use client';

import { useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { hasMinRole } from '@/lib/auth/roles';
import { NOTIFICATIONS_CHANGED_EVENT } from '@/lib/notifications/events';
import { countAssignedUnreadMessages } from '@/lib/notifications/unread-messages';

export function MobileMessageBadge() {
  const { user, accountId, accountRole } = useAuth();

  useEffect(() => {
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!mobile || !('serviceWorker' in navigator)
      || !user || !accountId || !accountRole || !hasMinRole(accountRole, 'agent')) return;

    const db = createClient();
    let cancelled = false;
    let revision = 0;
    const publish = async (count: number, requestRevision: number) => {
      const registration = await navigator.serviceWorker.getRegistration('/');
      if (!cancelled && requestRevision === revision) {
        registration?.active?.postMessage({ type: 'NEXOOMNI_UNREAD_MESSAGES', count });
      }
    };
    const refresh = async () => {
      const requestRevision = ++revision;
      try {
        const count = await countAssignedUnreadMessages(db, accountId, user.id);
        if (!cancelled && requestRevision === revision) await publish(count, requestRevision);
      } catch (error) {
        console.error('[pwa] Could not synchronize unread message badge:', error);
      }
    };
    const onChanged = () => { void refresh(); };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    void refresh();
    const poll = window.setInterval(onVisible, 30_000);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, onChanged);
    navigator.serviceWorker.addEventListener('controllerchange', onChanged);
    document.addEventListener('visibilitychange', onVisible);
    const channel = db.channel(`mobile-message-badge:${user.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'conversations',
        filter: `account_id=eq.${accountId}`,
      }, onChanged)
      .subscribe();

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, onChanged);
      navigator.serviceWorker.removeEventListener('controllerchange', onChanged);
      document.removeEventListener('visibilitychange', onVisible);
      void db.removeChannel(channel);
      navigator.serviceWorker.controller?.postMessage({ type: 'NEXOOMNI_UNREAD_MESSAGES', count: 0 });
    };
  }, [user, accountId, accountRole]);

  return null;
}
