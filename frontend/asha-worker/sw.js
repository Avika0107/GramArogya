/* GramArogya ASHA Worker PWA — service worker.
 *
 *  * Pre-caches the app shell at install so every page works offline.
 *  * API requests are NEVER cached: when offline they fail fast with 503 and
 *    the app stores records locally (IndexedDB) for later sync.
 *  * Navigation uses network-first with a cached fallback, so the app loads
 *    instantly when connectivity returns and still opens when fully offline.
 *  * Background Sync ('gramarogya-sync') nudges open pages to flush their
 *    pending queues; the manual "Sync Now" button covers every other case.
 */

const CACHE_NAME = 'gramarogya-asha-v10';
const APP_SHELL = [
  './',
  './index.html',
  './triage.html',
  './tasks.html',
  './sync.html',
  './referral.html',
  './tracking.html',
  './styles.css',
  './app.js',
  './db.js',
  './ai-i18n.js',
  './ai.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API — network only; offline fails fast so the app queues records locally
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  // Navigation — network first, cached shell fallback (works offline)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Static assets — network first, cached fallback. While online the app
  // always gets the latest build (no stale-cache surprises); when offline it
  // falls back to the cached shell.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || caches.match('./index.html'))
      )
  );
});

// Background Sync: tell open pages to flush their pending queues.
// (Manual "Sync Now" always works as a fallback for the demo.)
self.addEventListener('sync', (event) => {
  if (event.tag === 'gramarogya-sync') {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => client.postMessage({ type: 'run-sync' }));
      })
    );
  }
});