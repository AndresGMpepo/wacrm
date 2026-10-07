interface DesktopAlert {
  id: string;
  conversationId: string;
  title: string;
  body: string;
}

export async function showDesktopMessageAlert(alert: DesktopAlert): Promise<void> {
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (mobile || !('Notification' in window) || Notification.permission !== 'granted'
    || !('serviceWorker' in navigator)) return;

  const registration = await navigator.serviceWorker.getRegistration('/');
  if (!registration?.active) {
    console.warn('[pwa] Desktop system alert unavailable: no active service worker.');
    return;
  }
  const tag = `nexoomni-${alert.id}`;
  const existing = await registration.getNotifications({ tag });
  if (existing.length) return;
  await registration.showNotification(alert.title, {
    body: alert.body,
    icon: '/icon-192.png',
    tag,
    silent: false,
    requireInteraction: true,
    data: { url: `/inbox?c=${encodeURIComponent(alert.conversationId)}` },
  });
}
