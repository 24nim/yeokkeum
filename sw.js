// 엮음 — the app opens straight from this device (no waiting on a weak signal); new versions arrive in the background.
const V = 'yk-app-277d7be96f';
const SHELL = ['./', './index.html', './app.js?v=277d7be96f', './config.js', './manifest.webmanifest',
  './vendor/firebase-app-compat.js', './vendor/firebase-auth-compat.js', './vendor/firebase-firestore-compat.js',
  './icons/icon-192.png', './icons/favicon-32.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => (k.startsWith('yk-app-') && k !== V) || k === 'yk-fonts').map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function refresh(cache, req) {
  return fetch(req).then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(V);
    if (req.mode === 'navigate') {
      // the page itself: from this device at once, refreshed for next time
      const hit = await cache.match(req, { ignoreSearch: true }) || await cache.match('./index.html') || await cache.match('./');
      const net = refresh(cache, req).catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      return (await net) || Response.error();
    }
    const hit = await cache.match(req);
    if (hit) {
      if (/config\.js|manifest\.webmanifest/.test(url.pathname)) e.waitUntil(refresh(cache, req).catch(() => null));
      return hit;
    }
    try { return await refresh(cache, req); } catch (err) { return Response.error(); }
  })());
});
