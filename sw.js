const CACHE = 'invader-hunt-2026-07-17.2308';
const TILE_CACHE = 'tiles-v1';
const TILE_MAX = 2500; // ~50 Mo de tuiles de carte max
const ASSETS = [
  '.',
  'index.html',
  'style.css',
  'app.js',
  'version.js',
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
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== TILE_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function tileFirst(req) {
  const c = await caches.open(TILE_CACHE);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    await c.put(req, res.clone());
    trimTiles(c);
  }
  return res;
}

let trimming = false;
async function trimTiles(c) {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await c.keys();
    if (keys.length > TILE_MAX) {
      for (const k of keys.slice(0, keys.length - TILE_MAX)) await c.delete(k);
    }
  } finally {
    trimming = false;
  }
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.hostname === 'tile.openstreetmap.org') {
    e.respondWith(tileFirst(e.request));
    return;
  }
  if (url.origin !== location.origin) return; // API + routage : toujours réseau
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request))
  );
});
