// HugoPredict ist keine App mehr, sondern nur eine Website.
// Dieser Service Worker räumt alte Installationen auf: Cache löschen, sich selbst
// abmelden und offene Tabs einmal neu laden, damit sofort die aktuelle Seite erscheint.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
  })());
});
