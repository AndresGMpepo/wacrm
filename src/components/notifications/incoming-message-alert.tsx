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

    const playAlert = () => {
      try {
        const context = getAudioContext();
        if (!context) return;
        if (context.state === 'suspended') {
          void context.resume().catch(() => undefined);
        }
        const playTone = (frequency: number, startAt: number) => {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          const endAt = startAt + 0.42;

          oscillator.type = 'sine';
          oscillator.frequency.setValueAtTime(frequency, startAt);
          gain.gain.setValueAtTime(0.0001, startAt);
          gain.gain.exponentialRampToValueAtTime(0.24, startAt + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.0001, endAt);
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.start(startAt);
          oscillator.stop(endAt + 0.01);
        };

        // Two clear ascending notes are easier to notice than a short beep,
        // without requiring an audio file or producing a harsh alert.
        playTone(784, context.currentTime);
        playTone(1047, context.currentTime + 0.48);
      } catch {
        // Browsers can block audio until the user has interacted with the page.
      }
    };

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
          const notification = payload.new as Notification;
          if (
            notification.type !== 'incoming_message' &&
            notification.type !== 'negative_sentiment'
          ) {
            return;
          }

          playAlert();
          toast(notification.title, {
            description: notification.body,
            action: notification.conversation_id
              ? {
                  label: 'Abrir chat',
                  onClick: () =>
                    router.push(`/inbox?c=${notification.conversation_id}`),
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
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener('pointerdown', unlockAudio);
      document.removeEventListener('keydown', unlockAudio);
      audioContextRef.current?.close().catch(() => undefined);
      audioContextRef.current = null;
    };
  }, [router, user]);

  return null;
}
