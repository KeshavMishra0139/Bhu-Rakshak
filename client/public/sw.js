// Bhu-Rakshak service worker: makes the app installable and keeps the last-known picture usable offline.
//  • App shell (index.html, built assets, icons): network first for pages, cache first for hashed assets.
//  • Read-only data the citizen and officer screens need (places, roads, alerts, impact, layers…): network first,
//    falling back to the last good copy. Personal or write endpoints are never cached.
//  • Map tiles: cache first, fetched with CORS so they can be stored efficiently; the cache is capped.
// The live risk numbers themselves are kept by the page (client/src/lib/offline.ts), which also shows the
// "Offline — showing data from …" banner.
const VERSION = 'br-v1';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const DATA = `${VERSION}-data`;
const TILES = `${VERSION}-tiles`;
const MAX_TILES = 800;

const SHELL_URLS = ['/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png'];
// GET endpoints safe to keep for offline use (no personal data beyond the signed-in user's own profile).
const DATA_PATHS = [
  /^\/api\/auth\/me$/, /^\/api\/locations(\/[^/]+)?$/, /^\/api\/roads$/, /^\/api\/risk\/forecast$/, /^\/api\/stakeholders$/,
  /^\/api\/alerts$/, /^\/api\/impact\//, /^\/api\/layers\//, /^\/api\/community-reports$/, /^\/api\/map\/(config|seismic)$/, /^\/api\/factors$/,
];
const TILE_HOSTS = ['server.arcgisonline.com', 'tile.opentopomap.org'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => Promise.all(SHELL_URLS.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const okToStore = (res) => res && res.ok && !res.redirected && res.type !== 'opaque';

async function networkFirst(req, cacheName, key = req) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (okToStore(res)) cache.put(key, res.clone());
    else if (res.status === 401 || res.status === 403) cache.delete(key);
    return res;
  } catch (e) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw e;
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (okToStore(res)) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const fresh = fetch(req).then((res) => { if (okToStore(res)) cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || fresh;
}

async function trimTiles() {
  const cache = await caches.open(TILES);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}

async function tile(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  try {
    // Ask for a CORS response so it can be cached at its real size (opaque responses cost far more quota).
    const res = await fetch(req.url, { mode: 'cors', credentials: 'omit' });
    if (res.ok) {
      cache.put(req.url, res.clone());
      if (Math.random() < 0.05) trimTiles();
    }
    return res;
  } catch {
    return fetch(req); // host without CORS: use it normally, just don't keep it
  }
}

/** Pages: network first; offline, the cached app shell (the router then shows the right screen). */
async function page(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (okToStore(res) && (res.headers.get('content-type') || '').includes('text/html')) cache.put('/index.html', res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match('/index.html');
    if (hit) return hit;
    throw e;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;

  if (req.method !== 'GET') {
    // Signing out (or in as someone else) must not leave the previous person's profile in the cache.
    if (same && /^\/api\/auth\/(logout|login|demo)$/.test(url.pathname)) {
      event.respondWith(fetch(req).finally(() => caches.open(DATA).then((c) => c.delete('/api/auth/me'))));
    }
    return;
  }
  if (same) {
    if (url.pathname.startsWith('/api/')) {
      if (DATA_PATHS.some((re) => re.test(url.pathname))) event.respondWith(networkFirst(req, DATA));
      return; // live stream, polling, personal and write endpoints: straight to the network
    }
    if (url.pathname.startsWith('/__access')) return;
    if (req.mode === 'navigate') { event.respondWith(page(req)); return; }
    if (url.pathname.startsWith('/assets/')) { event.respondWith(cacheFirst(req, ASSETS)); return; }
    event.respondWith(staleWhileRevalidate(req, SHELL)); // icons, manifest, /data/*.json, /geo
    return;
  }
  if (TILE_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) { event.respondWith(tile(req)); return; }
  if (FONT_HOSTS.includes(url.hostname)) event.respondWith(staleWhileRevalidate(req, ASSETS));
});
