import {
  canCacheResponse,
  isFreshResponse,
  isSafeAssetRequest,
  stampCachedResponse,
} from "/pwa-cache-policy.js";

const VERSION = "2026-08-11-1";
const CACHE_PREFIX = "giromesa-ops-static-";
const STATIC_CACHE = `${CACHE_PREFIX}${VERSION}`;
const ASSET_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const PRECACHE = [
  "/manifest.webmanifest",
  "/icons/pwa-192.svg",
  "/icons/pwa-512.svg",
  "/pwa-cache-policy.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      const versions = keys
        .filter((key) => key.startsWith(CACHE_PREFIX))
        .sort()
        .reverse();
      await Promise.all(versions.slice(2).map((key) => caches.delete(key)));
      await self.clients.claim();
    }),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
  }
  if (event.data?.type === "CLEAR_RUNTIME_CACHE") {
    event.waitUntil(
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys.filter((key) => key.startsWith(CACHE_PREFIX)).map((key) => caches.delete(key)),
          ),
        ),
    );
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (!isSafeAssetRequest(request, self.location.origin)) return;

  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached && isFreshResponse(cached, Date.now(), ASSET_TTL_MS)) return cached;
      if (cached) await cache.delete(request);

      try {
        const response = await fetch(request);
        if (canCacheResponse(response)) {
          await cache.put(request, stampCachedResponse(response.clone()));
        }
        return response;
      } catch (error) {
        if (cached) return cached;
        throw error;
      }
    }),
  );
});
