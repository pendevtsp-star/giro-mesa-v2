import { fetchRuntimeAsset, isSafeAssetRequest } from "/pwa-cache-policy.js";

const VERSION = "2026-08-11-2";
const CACHE_PREFIX = "giromesa-ops-static-";
const STATIC_CACHE = `${CACHE_PREFIX}${VERSION}`;
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

  event.respondWith(caches.open(STATIC_CACHE).then((cache) => fetchRuntimeAsset(request, cache)));
});
