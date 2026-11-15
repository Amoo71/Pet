// Offline support: network-first for app files, cached copy as offline fallback.
const CACHE = 'tendies-studio-v11';
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
  './src/core/rawmorph.js',
  './src/app/icons.js',
  './src/browser/duo-fold.js',
  './src/core/tendies.js',
  './src/core/plist.js',
  './src/core/zip.js',
  './src/core/devices.js',
  './src/core/bplist.js',
  './src/core/template-data.js',
  './src/browser/gif.js',
  './src/browser/depth.js',
  './src/app/effects.js',
  './src/browser/catalog.js',
  './src/browser/gifsearch.js',
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
  // network-first for the app code so updates arrive immediately, cache as offline fallback
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        return (await cache.match(req, { ignoreSearch: true })) || Response.error();
      }
    })
  );
});
