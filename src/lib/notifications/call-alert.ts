export const callAlertTag = (extension: string) => `nexoomni-call-${extension}`;

interface CallAlert {
  extension: string;
  title: string;
  body: string;
  ringing: boolean;
}

async function activeRegistration() {
  if (!('Notification' in window) || Notification.permission !== 'granted'
    || !('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration('/');
  return registration?.active ? registration : null;
}

/**
 * Shows the system call alert through the service worker so it works on
 * Android (where `new Notification` is unavailable) and shares its tag with
 * the server push for the same extension, collapsing both into one entry.
 * Skipped while NexoOmni has focus: the in-app card already rings there.
 */
export async function showCallSystemAlert(alert: CallAlert): Promise<void> {
  if (document.hasFocus()) return;
  const registration = await activeRegistration();
  if (!registration) return;
  const tag = callAlertTag(alert.extension);
  const ringingAt = Date.now();
  await registration.showNotification(alert.title, {
    body: alert.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag,
    silent: false,
    renotify: true,
    requireInteraction: alert.ringing,
    ...(alert.ringing ? { vibrate: [600, 300, 600, 300, 600, 300, 600] } : {}),
    data: { url: '/inbox', focusOnly: true, ...(alert.ringing ? { ringingAt } : {}) },
  } as NotificationOptions);
}

export async function closeCallSystemAlert(extension: string): Promise<void> {
  const registration = await activeRegistration();
  if (!registration) return;
  const notifications = await registration.getNotifications({ tag: callAlertTag(extension) });
  notifications.forEach((notification) => notification.close());
}
