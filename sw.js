/**
 * Bump CACHE_VERSION on every release. Without it iOS will happily serve a
 * month-old calculator from its cache and you will lose an evening to it.
 */
const CACHE_VERSION = 'manocalc-v23';

/* Paths are relative to this file, so the app works from a GitHub Pages
   subpath (/calc/) exactly as it does from a domain root. */
const PRECACHE = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './src/ui.js',
  './src/model.js',
  './src/parser.js',
  './src/tokenizer.js',
  './src/eval.js',
  './src/format.js',
  './src/errors.js',
  './src/history.js',
  './src/radix.js',
  './src/units.js',
  './src/currency.js',
  './src/time.js',
  './src/sw-register.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE.map((p) => new Request(p, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // The rate feed is the app's only cross-origin request, and this worker is
  // cache-first over every GET with `ignoreSearch: true` — precisely the shape
  // that would pin one morning's exchange rate in place forever. Nothing writes
  // to the cache at runtime today, so it cannot happen yet; one line now is
  // cheaper than diagnosing a frozen rate later.
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(request).catch(() => {
        // Offline and unseen: navigations still get the shell.
        if (request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});
