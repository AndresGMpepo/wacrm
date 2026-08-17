'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import type { Notification } from '@/types';

/** Global listener for notification rows addressed to the signed-in user. */
export function IncomingMessageAlert() {
  const router = useRouter();
  const { user } = useAuth();
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!user) return;

    const supabase = createClient();
    const getAudioContext = () => {
      const AudioContextClass = window.AudioContext;
      if (!AudioContextClass) return null;

      const context = audioContextRef.current ?? new AudioContextClass();
      audioContextRef.current = context;
      return context;
    };

    // Chrome only permits audible Web Audio after a user gesture. Creating
    // and resuming the context here means a later Realtime callback can play
    // immediately instead of being silently blocked by autoplay protection.
    const unlockAudio = () => {
      const context = getAudioContext();
      if (context?.state === 'suspended') {
        void context.resume().catch(() => undefined);
      }
    };
    document.addEventListener('pointerdown', unlockAudio, { once: true });
    document.addEventListener('keydown', unlockAudio, { once: true });

    const playAlert = (kind: Notification['type']) => {
      try {
        const context = getAudioContext();
        if (!context) return;
        if (context.state === 'suspended') {
          void context.resume().catch(() => undefined);
        }
        const playTone = (frequency: number, startAt: number, duration = 0.42, volume = 0.24) => {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          const endAt = startAt + duration;

          oscillator.type = 'sine';
          oscillator.frequency.setValueAtTime(frequency, startAt);
          gain.gain.setValueAtTime(0.0001, startAt);
          gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.0001, endAt);
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.start(startAt);
          oscillator.stop(endAt + 0.01);
        };

        if (kind === 'negative_sentiment') {
          // A three-pulse alarm is intentionally unlike the two-note message
          // chime, so a supervisor can recognise an escalation by ear.
          playTone(660, context.currentTime, 0.22, 0.34);
          playTone(660, context.currentTime + 0.31, 0.22, 0.34);
          playTone(880, context.currentTime + 0.62, 0.35, 0.36);
          return;
        }

        // Two clear ascending notes are easier to notice than a short beep,
        // without requiring an audio file or producing a harsh alert.
        playTone(784, context.currentTime);
        playTone(1047, context.currentTime + 0.48);
      } catch {
        // Browsers can block audio until the user has interacted with the page.
      }
    };

    // Realtime is the fast path, but a browser can briefly lose its socket
    // after sleep, a network change, or a token refresh. Keep a small
    // notification inbox poll as a safety net so an incoming WhatsApp message
    // never becomes silent just because that single INSERT was missed.
    const observedNotificationIds = new Set<string>();
    let hydrated = false;

    const showNotification = (notification: Notification) => {
      if (observedNotificationIds.has(notification.id)) return;
      observedNotificationIds.add(notification.id);

      if (
        notification.type !== 'incoming_message' &&
        notification.type !== 'negative_sentiment' &&
        notification.type !== 'call_follow_up'
      ) {
        return;
      }

      playAlert(notification.type);
      const notify = notification.type === 'negative_sentiment'
        ? toast.error
        : notification.type === 'call_follow_up'
          ? toast.warning
          : toast;
      notify(notification.title, {
        description: notification.body,
        action: notification.conversation_id
          ? {
              label: 'Abrir chat',
              onClick: () => router.push(`/inbox?c=${notification.conversation_id}`),
            }
          : undefined,
      });

      if (
        document.visibilityState !== 'visible' &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        const browserNotification = new Notification(notification.title, {
          body: notification.body,
          icon: '/icon',
        });
        browserNotification.onclick = () => {
          window.focus();
          if (notification.conversation_id) {
            router.push(`/inbox?c=${notification.conversation_id}`);
          }
          browserNotification.close();
        };
      }
    };

    const refreshMissedNotifications = async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(25);

      if (error || !data) return;

      // Seed existing records without replaying old alerts at login. Every
      // later record that wasn't delivered by Realtime is announced once.
      if (!hydrated) {
        data.forEach((row) => observedNotificationIds.add(row.id));
        hydrated = true;
        return;
      }
      data.slice().reverse().forEach((row) => showNotification(row as Notification));
    };

    void refreshMissedNotifications();
    const notificationPoll = window.setInterval(() => {
      void refreshMissedNotifications();
    }, 10_000);
    const rehydrateOnVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshMissedNotifications();
      }
    };
    document.addEventListener('visibilitychange', rehydrateOnVisible);

    const channel = supabase
      .channel(`incoming-message-alert:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          showNotification(payload.new as Notification);
        }
      )
      .subscribe();

    return () => {
      window.clearInterval(notificationPoll);
      document.removeEventListener('visibilitychange', rehydrateOnVisible);
      supabase.removeChannel(channel);
      document.removeEventListener('pointerdown', unlockAudio);
      document.removeEventListener('keydown', unlockAudio);
      audioContextRef.current?.close().catch(() => undefined);
      audioContextRef.current = null;
    };
  }, [router, user]);

  return null;
}
