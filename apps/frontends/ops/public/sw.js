const CACHE_NAME = "giromesa-ops-shell-v0.2.3-r2";
const SCOPE_URL = new URL(self.registration.scope);
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./icons/giromesa-192.png",
  "./icons/giromesa-512.png",
  "./icons/giromesa-maskable-512.png",
  "./icons/giromesa.svg",
  "./icons/giromesa-maskable.svg",
].map((path) => new URL(path, SCOPE_URL).toString());

function isSensitive(url) {
  const path = url.pathname.toLowerCase();
  return (
    path.includes("/v1/") ||
    path.includes("/auth/") ||
    path.includes("/payment") ||
    path.includes("/payments")
  );
}

function isStaticAsset(request, url) {
  return (
    ["font", "image", "manifest", "script", "style", "worker"].includes(request.destination) ||
    url.pathname.startsWith(`${SCOPE_URL.pathname}assets/`) ||
    url.pathname.startsWith(`${SCOPE_URL.pathname}icons/`)
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== SCOPE_URL.origin || isSensitive(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(new URL("./index.html", SCOPE_URL))));
    return;
  }

  if (!isStaticAsset(request, url)) return;
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
