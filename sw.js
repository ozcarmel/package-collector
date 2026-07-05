self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await self.caches.keys();
      await Promise.all(cacheNames.map((cacheName) => self.caches.delete(cacheName)));
      await self.clients.claim();
      const clients = await self.clients.matchAll({
        includeUncontrolled: true,
        type: "window",
      });
      clients.forEach((client) => {
        client.postMessage({ type: "LAHAV_PACKAGE_COLLECTOR_SW_CLEANED" });
      });
      await self.registration.unregister();
    })(),
  );
});
