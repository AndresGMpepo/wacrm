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
    const playAlert = () => {
      try {
        const AudioContextClass = window.AudioContext;
        if (!AudioContextClass) return;

        const context = audioContextRef.current ?? new AudioContextClass();
        audioContextRef.current = context;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.setValueAtTime(880, context.currentTime);
        gain.gain.setValueAtTime(0.0001, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(
          0.12,
          context.currentTime + 0.02
        );
        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          context.currentTime + 0.3
        );
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.31);
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
          if (notification.type !== 'incoming_message') return;

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
      audioContextRef.current?.close().catch(() => undefined);
      audioContextRef.current = null;
    };
  }, [router, user]);

  return null;
}
