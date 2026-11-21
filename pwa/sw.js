const CACHE_NAME = "dms-cache-v4";
const APP_SHELL = [
  "./",
  "./index.html",
  "./vouch.html",
  "./styles.css",
  "./app.js",
  "./crypto.js",
  "./checkin.js",
  "./chain.js",
  "./queue.js",
  "./keydelivery.js",
  "./duress.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "https://cdn.jsdelivr.net/npm/ethers@6.13.4/dist/ethers.umd.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((oldKey) => caches.delete(oldKey))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // Never cache local Hardhat RPC calls
  if (req.url.includes(":8545")) return;

  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});