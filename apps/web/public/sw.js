/* eslint-disable no-undef */
/*
 * Service Worker für den Einkaufszettel (T4.1).
 *
 * Strategie:
 * - App-Shell (/, /offline, /offline.html, Manifest, Icons) beim Install precachen.
 * - Navigationen: network-first mit Fallback auf die gecachte Shell bzw. Offline-Seite.
 * - /_next/static/*, /icons/* und das Manifest: stale-while-revalidate.
 * - /rest/v1/*, /auth/v1/*, /api/*: niemals cachen.
 *
 * Versionierter Cache-Name; `activate` löscht alle alten Caches.
 */

const CACHE_VERSION = 'v1';
const PRECACHE_CACHE = `einkaufszettel-precache-${CACHE_VERSION}`;
const RUNTIME_CACHE = `einkaufszettel-runtime-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/',
  '/offline',
  '/offline.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon-180.png',
];

const NEVER_CACHE_PREFIXES = ['/rest/v1/', '/auth/v1/', '/api/'];

function isNeverCachedPath(pathname) {
  return NEVER_CACHE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isAssetPath(pathname) {
  return (
    pathname.startsWith('/_next/static/') ||
    pathname.startsWith('/icons/') ||
    pathname === '/manifest.webmanifest'
  );
}

async function precache() {
  const cache = await caches.open(PRECACHE_CACHE);
  // Einzelne Fehler (z. B. eine Route, die im Dev-Server noch nicht existiert)
  // dürfen die Installation nicht komplett verhindern.
  await Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)));
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const url = new URL(request.url);
      // Nur die App-Shell aktualisieren – keine privaten Listen-HTMLs cachen.
      if (url.origin === self.location.origin && url.pathname === '/') {
        const cache = await caches.open(PRECACHE_CACHE);
        await cache.put('/', response.clone());
      }
    }
    return response;
  } catch {
    const cache = await caches.open(PRECACHE_CACHE);
    const cached = (await cache.match(request)) || (await cache.match('/'));
    return cached || (await cache.match('/offline.html')) || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then(async (response) => {
      if (response && response.ok) {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);

  if (cached) return cached;
  return (await network) || Response.error();
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      await precache();
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const expected = new Set([PRECACHE_CACHE, RUNTIME_CACHE]);
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => !expected.has(key)).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isNeverCachedPath(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isAssetPath(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
