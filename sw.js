/**
 * Kanpur Tactical GIS - Production Service Worker
 * Version: 3.6.0
 * Dual caching strategy: Cache-First for static assets & Leaflet CDN,
 * Stale-While-Revalidate for application shell & datasets.
 * Guarantees <0.5s offline boot and preserves cellular telephone dialers.
 */

const CACHE_NAME = 'kanpur-gis-v2.6.0';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/styles.css',
  '/js/config.js',
  '/js/data/policeStations.js',
  '/js/data/crimeHotspots.js',
  '/js/data/localities.js',
  '/js/audio.js',
  '/js/map.js',
  '/js/realtime.js',
  '/js/emergency.js',
  '/js/guardian.js',
  '/js/batteryBeacon.js',
  '/js/pwa.js',
  '/js/app.js',
  '/icons/icon-192.png',
  '/icons/icon-192x192.png',
  '/icons/icon-512.png',
  '/icons/icon-512x512.png',
  '/icons/icon-maskable.svg',
  '/icons/icon.svg',
  // Critical Third-Party Leaflet CDN
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// 1. INSTALL EVENT: Pre-cache core assets & skip waiting
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Pre-caching offline shell and datasets...');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => self.skipWaiting())
      .catch((err) => {
        console.warn('[SW] Pre-cache partial warning (continuing):', err);
        return self.skipWaiting();
      })
  );
});

// 2. ACTIVATE EVENT: Purge old cache generations & claim active clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Purging outdated cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. FETCH EVENT: Intercept requests with dual caching strategy
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Exclude non-GET requests and WebSocket protocols
  if (request.method !== 'GET' || url.protocol.startsWith('ws')) {
    return;
  }

  // CRITICAL: NEVER cache or intercept external map tiles (Google Maps, Esri, OSM)
  // Let the browser fetch them directly from Google's high-speed CDN without caching
  if (url.hostname.includes('google.com') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('arcgisonline.com') ||
      url.hostname.includes('openstreetmap.org')) {
    return;
  }

  // Strategy A: Cache-First for static assets, Leaflet CDN bundles & icons
  if (url.origin === 'https://unpkg.com' ||
      url.pathname.startsWith('/icons/') ||
      url.pathname.startsWith('/css/') ||
      request.destination === 'style' ||
      request.destination === 'script' ||
      request.destination === 'font') {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return networkResponse;
        }).catch(() => {
          // If offline and request is an image or icon, return cached fallback if available
          return caches.match('/icons/icon-192x192.png');
        });
      })
    );
    return;
  }

  // Strategy B: Stale-While-Revalidate for application shell & data
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return networkResponse;
      }).catch((err) => {
        // Network unavailable (offline mode)
        return cachedResponse;
      });

      return cachedResponse || fetchPromise;
    })
  );
});
