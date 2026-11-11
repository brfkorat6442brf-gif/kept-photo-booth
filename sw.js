// Service Worker สำหรับ Kept Photo Booth (Offline Support & PWA Standalone Mode)
const CACHE_NAME = 'kept-booth-v2.6';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './prototype.html',
  './download.html',
  './qrcode.min.js',
  './gif_encoder.js',
  './manifest.json',
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700;900&family=VT323&family=Noto+Sans+Thai:wght@400;600;800&family=Playfair+Display:ital,wght@1,700&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request).catch(() => {
        // Fallback to cache
        return caches.match('./index.html');
      });
    })
  );
});
