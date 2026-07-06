const cacheVersion = "lahav-package-collector-pwa-v20260706";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await self.caches.keys();
      await Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== cacheVersion)
          .map((cacheName) => self.caches.delete(cacheName)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
