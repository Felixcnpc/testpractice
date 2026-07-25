// Service Worker for 采气工中级刷题 PWA
const CACHE_NAME = 'caifu-v3';
const FILES_TO_CACHE = [
  './standalone.html',
  './manifest.json',
];

// Install: pre-cache core files
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(FILES_TO_CACHE).catch(err => {
        console.warn('SW: some files failed to pre-cache', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => {
      return Promise.all(
        names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
      );
    })
  );
  self.clients.claim();
});

// Fetch: cache-first (instant load, silent background update)
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      // Always try to update cache in background
      const fetchPromise = fetch(event.request).then(response => {
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(() => null);

      // Return cached immediately if available, otherwise wait for network
      return cached || fetchPromise.then(r => r || caches.match('./standalone.html'));
    })
  );
});
