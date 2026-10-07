const STATIC_CACHE = 'nexoomni-static-v1';
const PRECACHE_URLS = [
  '/offline.html',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith('nexoomni-static-') && cacheName !== STATIC_CACHE)
          .map((cacheName) => caches.delete(cacheName)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.get('upgrade') === 'websocket') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const offlinePage = await caches.match('/offline.html');
        if (offlinePage) return offlinePage;
        return new Response('Sin conexión', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }),
    );
    return;
  }

  const nextStaticAsset = url.pathname.startsWith('/_next/static/')
    && ['script', 'style', 'font'].includes(request.destination);
  const pwaIcon = /^\/(?:icon-(?:192|512|maskable-512)\.png|apple-touch-icon\.png)$/.test(url.pathname)
    && request.destination === 'image';
  if (!nextStaticAsset && !pwaIcon) return;

  event.respondWith(
    fetch(request).then((response) => {
      if (response.ok && response.type === 'basic') {
        const responseToCache = response.clone();
        void caches.open(STATIC_CACHE).then((cache) => cache.put(request, responseToCache));
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      return new Response('', { status: 504, statusText: 'Offline asset unavailable' });
    }),
  );
});

const isMobileDevice = () => /Android|iPhone|iPad|iPod|Mobile/i.test(self.navigator.userAgent);

async function updateMobileBadge(count) {
  if (!isMobileDevice() || !Number.isSafeInteger(count) || count < 0) return;
  try {
    if (count === 0 && self.navigator.clearAppBadge) {
      await self.navigator.clearAppBadge();
    } else if (self.navigator.setAppBadge) {
      await self.navigator.setAppBadge(count);
    }
  } catch (error) {
    console.error('[pwa] Could not update mobile app badge:', error);
  }
}

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'NEXOOMNI_UNREAD_MESSAGES') return;
  event.waitUntil(updateMobileBadge(event.data.count));
});

// Calls use one tag per extension so the page alert and the server push
// collapse into one entry. A still-ringing entry is not repeated; an older
// one (a previous call) is replaced and alerts again.
const CALL_RING_WINDOW_MS = 60_000;
const CALL_VIBRATION = [600, 300, 600, 300, 600, 300, 600];

async function showCallNotification(payload) {
  // A focused NexoOmni window is already ringing through NexPhone.
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (windows.some((client) => client.focused)) return;
  const existing = await self.registration.getNotifications({ tag: payload.tag });
  const ringingAt = Number.isFinite(payload.ringingAt) ? payload.ringingAt : Date.now();
  const stillRinging = existing.some((notification) => {
    const previous = notification.data?.ringingAt;
    return Number.isFinite(previous) && Math.abs(ringingAt - previous) < CALL_RING_WINDOW_MS;
  });
  if (stillRinging) return;
  await self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.tag,
    silent: false,
    renotify: true,
    requireInteraction: true,
    vibrate: CALL_VIBRATION,
    data: { url: payload.url, focusOnly: true, ringingAt },
  });
}

self.addEventListener('push', (event) => {
  if (!event.data) return;
  event.waitUntil((async () => {
    const payload = event.data.json();
    if (payload.kind === 'call') {
      await showCallNotification(payload);
      return;
    }
    // A visible browser window can be behind another app. Push must always
    // display a system notification, independently of page visibility.
    const existing = await self.registration.getNotifications({ tag: payload.tag });
    if (!existing.length) await self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: payload.tag,
      silent: false,
      renotify: false,
      requireInteraction: !isMobileDevice(),
      vibrate: [200, 100, 200],
      data: { url: payload.url },
    });
    await updateMobileBadge(payload.unreadCount);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(
    typeof event.notification.data?.url === 'string' ? event.notification.data.url : '/',
    self.location.origin,
  );
  if (target.origin !== self.location.origin) return;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
      // Navigating would reload the page and drop the ringing WebRTC session.
      if (existing && event.notification.data?.focusOnly === true) return existing.focus();
      if (existing) {
        await existing.navigate(target.href);
        return existing.focus();
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
