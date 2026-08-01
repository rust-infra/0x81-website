const CACHE_NAME = 'moyan-v2';

// Assets to cache on install
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/favicon.ico',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/ink-wash-bg.jpg',
  '/scholar.jpg',
  '/vocabulary.json',
];

// Install: cache core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => {
      self.skipWaiting();
    })
  );
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      self.clients.claim();
    })
  );
});

// Fetch: cache-first strategy for assets, network-first for API/data
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip browser extensions and non-http(s) schemes
  if (!url.protocol.startsWith('http')) return;

  // Never intercept API requests — the UI must always get fresh data,
  // otherwise mutations (add card, update deck, ...) appear stale.
  if (url.pathname.startsWith('/api/')) return;

  // Static assets: cache-first
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // HTML pages: network-first with cache fallback
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // Default: stale-while-revalidate
  event.respondWith(staleWhileRevalidate(request));
});

function isStaticAsset(url) {
  const staticExts = ['.js', '.css', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.woff2', '.json'];
  return staticExts.some((ext) => url.pathname.endsWith(ext));
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return cached || new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response('<h1>离线模式</h1><p>请连接网络后重试</p>', {
      status: 503,
      headers: { 'Content-Type': 'text/html' },
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => cached);

  return cached || fetchPromise;
}
