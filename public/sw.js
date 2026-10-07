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

self.addEventListener('push', (event) => {
  if (!event.data) return;
  const payload = event.data.json();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const activeAppClient = clients.some((client) => {
        const url = new URL(client.url);
        return url.origin === self.location.origin
          && client.visibilityState === 'visible'
          && !['/login', '/signup'].includes(url.pathname);
      });
      if (activeAppClient) return;

      await self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: payload.tag,
        data: { url: payload.url },
      });
    }),
  );
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
      if (existing) {
        await existing.navigate(target.href);
        return existing.focus();
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
