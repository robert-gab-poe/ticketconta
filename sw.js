// Service worker: app shell offline + caché de librerías del CDN.
const VERSION = 'ticketconta-v1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './js/app.js',
  './js/db.js',
  './js/extract.js',
  './js/accounting.js',
  './js/image.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Nunca cachear la API de Claude.
  if (url.hostname.endsWith('anthropic.com')) return;

  const isCdn = url.hostname === 'cdn.jsdelivr.net';
  if (url.origin === self.location.origin) {
    // Red primero (para recibir actualizaciones), caché si no hay conexión.
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
  } else if (isCdn) {
    // Librerías versionadas: caché primero.
    e.respondWith(
      caches.match(req).then((hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok || res.type === 'opaque') {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
      )
    );
  }
});
