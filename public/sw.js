// HugoPredict als App: Grundgerüst offline verfügbar, Inhalte immer frisch vom Server.
const CACHE = 'hugopredict-v1';
const SHELL = ['/', '/index.html', '/app.js', '/style.css', '/lmsr.js', '/logo.png', '/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Nur eigene GET-Anfragen; Daten (API) und Teilen-Links nie aus dem Cache.
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/m/')) return;
  // Netz zuerst (Updates kommen sofort an), offline aus dem Cache.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('/'))),
  );
});
