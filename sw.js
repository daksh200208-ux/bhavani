/**
 * Bhavani - Kanpur Women Safety Grid
 * Production Service Worker (v3.0.0)
 * Dual caching strategy:
 * - Cache-First for immutable Leaflet CDN & vendor font bundles
 * - Network-First for application shell, styles, and scripts so phones always receive live updates immediately
 * Guarantees zero stale-cache traps and offline resilience.
 */

const CACHE_NAME = 'bhavani-v3.0.0-kanpur-gis-v2.6.0';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/styles.css',
  '/js/config.js',
  '/js/data/policeStations.js',
  '/js/data/crimeHotspots.js',
  '/js/data/wantedCriminals.js',
  '/js/data/localities.js',
  '/js/audio.js',
  '/js/map.js',
  '/js/realtime.js',
  '/js/emergency.js',
  '/js/dossiers.js',
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

// 1. INSTALL EVENT: Pre-cache core assets & skip waiting immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
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

// 2. ACTIVATE EVENT: Purge all old cache generations & immediately claim clients
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

// 3. FETCH EVENT: Network-First for application files; Cache-First for CDN
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Exclude non-GET requests and WebSocket protocols
  if (request.method !== 'GET' || url.protocol.startsWith('ws')) {
    return;
  }

  // CRITICAL: NEVER cache or intercept external map tiles (Google Maps, Esri, OSM)
  if (url.hostname.includes('google.com') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('arcgisonline.com') ||
      url.hostname.includes('openstreetmap.org')) {
    return;
  }

  // Strategy A: Cache-First ONLY for immutable external CDN assets (Leaflet CDN, fonts)
  if (url.origin === 'https://unpkg.com' || request.destination === 'font') {
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
        });
      })
    );
    return;
  }

  // Strategy B: Network-First for ALL application shell, scripts, styles, and data
  // Ensures phones ALWAYS receive latest live updates when online, with instant offline fallback
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Network unavailable: serve from local offline cache
        return caches.match(request).then((cached) => {
          if (cached) return cached;
          if (request.destination === 'image') {
            return caches.match('/icons/icon-192x192.png');
          }
          return caches.match('/');
        });
      })
  );
});
