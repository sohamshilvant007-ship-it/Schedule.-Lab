const CACHE_NAME = 'schedule-lab-v6';
const ASSETS = [
  './index.html',
  './manifest.json',
  './icon-48.png', './icon-72.png', './icon-96.png', './icon-128.png',
  './icon-144.png', './icon-152.png', './icon-180.png', './icon-192.png',
  './icon-256.png', './icon-384.png', './icon-512.png', './icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});

/* Background Sync: lets the app defer a "save" until network is back.
   The app itself is localStorage-only (no server to sync to), so this
   currently just re-caches the latest page on reconnect. If a real
   backend is added later, the actual sync logic goes inside this event. */
self.addEventListener('sync', (event) => {
  if (event.tag === 'schedule-lab-resync') {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => cache.add('./index.html'))
    );
  }
});

/* Web Push: requires a push server to send messages (none exists here yet).
   This listener is ready to display a push notification the moment a
   real push subscription + server is wired up. */
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.text() : 'Schedule Lab reminder';
  event.waitUntil(
    self.registration.showNotification('Schedule Lab', { body: data, icon: './icon-192.png', badge: './icon-96.png' })
  );
});

/* Clicking any notification (local or push) opens/focuses the app,
   instead of just showing a bare URL. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('./index.html');
    })
  );
});
