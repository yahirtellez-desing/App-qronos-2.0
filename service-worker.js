// ============================================================
// QRONOS 2.0 · Service Worker v2.0
// Estrategia: Cache-First para estáticos, Network-First para API
// ============================================================

const CACHE_NAME = 'qronos-v2.0.0';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js'
];

// ── Install: cachear activos estáticos ──────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Algunos activos no se cachearon:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: limpiar caches viejos ────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// ── Fetch: estrategia según tipo de recurso ─────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API calls → Network First (con fallback a cache si disponible)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request.clone())
        .then((response) => {
          if (response.ok && request.method === 'GET') {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Activos estáticos → Cache First
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
        return response;
      });
    })
  );
});

// ── Background Sync (para guardar registros offline) ────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-records') {
    event.waitUntil(syncPendingRecords());
  }
});

async function syncPendingRecords() {
  // El cliente maneja la cola; aquí solo notificamos
  const clients = await self.clients.matchAll();
  clients.forEach((client) => client.postMessage({ type: 'SYNC_REQUESTED' }));
}

// ── Push Notifications (placeholder para futuro) ────────────
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: 'QRONOS', body: 'Nueva actualización' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-72.png'
    })
  );
});
