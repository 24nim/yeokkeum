// 엮음 — offline support. App files: network first (so updates arrive), cache when offline.
const V = 'yk-app-8091cb67d9';
const SHELL = ['./', './index.html', './app.js?v=8091cb67d9', './config.js', './manifest.webmanifest',
  './vendor/firebase-app-compat.js', './vendor/firebase-auth-compat.js', './vendor/firebase-firestore-compat.js',
  './icons/icon-192.png', './icons/favicon-32.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith('yk-app-') && k !== V).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)); }
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(V);
      try {
        const res = await Promise.race([fetch(req), timeout(req.mode === 'navigate' ? 3500 : 6000)]);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' }) || await caches.match(req);
        if (hit) return hit;
        if (req.mode === 'navigate') { const idx = await cache.match('./index.html') || await cache.match('./'); if (idx) return idx; }
        return Response.error();
      }
    })());
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open('yk-fonts').then((c) => c.match(req).then((hit) => {
      const net = fetch(req).then((res) => { if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })));
  }
});
