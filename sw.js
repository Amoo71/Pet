// Offline support: cache-first for the app shell, refreshed in the background.
const CACHE = 'tendies-studio-v1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './src/app/main.js',
  './src/app/store.js',
  './src/app/dom.js',
  './src/app/preview.js',
  './src/app/panels.js',
  './src/app/actions.js',
  './src/app/assets.js',
  './src/app/spring.js',
  './src/app/templates.js',
  './src/core/model.js',
  './src/core/caml.js',
  './src/core/tendies.js',
  './src/core/plist.js',
  './src/core/zip.js',
  './src/core/devices.js',
  './src/browser/raster.js',
  './src/browser/storage.js',
  './src/browser/video.js',
  './src/browser/importer.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
