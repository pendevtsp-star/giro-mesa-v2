const CACHE_NAME = "giromesa-ops-shell-v0.2.4-r1";
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

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url;
  if (typeof target !== "string") return;
  const targetUrl = new URL(target, SCOPE_URL);
  if (targetUrl.origin !== SCOPE_URL.origin || !targetUrl.pathname.startsWith(SCOPE_URL.pathname)) {
    return;
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      const existing = clients.find((client) => new URL(client.url).origin === SCOPE_URL.origin);
      if (existing) {
        await existing.focus();
        return existing.navigate(targetUrl.toString());
      }
      return self.clients.openWindow(targetUrl.toString());
    }),
  );
});

self.addEventListener("push", (event) => {
  let payload;
  try {
    payload = event.data?.json();
  } catch {
    payload = null;
  }
  const route = payload?.route === "#/counter" ? "#/counter" : "#/salon";
  const title =
    typeof payload?.title === "string" && payload.title.length <= 80
      ? payload.title
      : "Nova atenção operacional";
  const body =
    typeof payload?.body === "string" && payload.body.length <= 180
      ? payload.body
      : "Abra o GiroMesa para verificar a fila.";
  const tag =
    typeof payload?.tag === "string" && /^[A-Za-z0-9:_-]{1,80}$/.test(payload.tag)
      ? payload.tag
      : "operational-attention";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      badge: new URL("icons/giromesa-192.png", SCOPE_URL).toString(),
      icon: new URL("icons/giromesa-192.png", SCOPE_URL).toString(),
      tag,
      renotify: true,
      data: { url: new URL(route, SCOPE_URL).toString() },
    }),
  );
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
