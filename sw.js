const CACHE = 'invader-hunt-v1';
const ASSETS = [
  '.',
  'index.html',
  'style.css',
  'app.js',
  'vendor/leaflet.js',
  'vendor/leaflet.css',
  'vendor/images/marker-icon.png',
  'vendor/images/marker-icon-2x.png',
  'vendor/images/marker-shadow.png',
  'data/invaders.json',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // API + tuiles : toujours réseau
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request))
  );
});
