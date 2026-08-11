const SAFE_DESTINATIONS = new Set(["style", "script", "image", "font", "manifest"]);
const SAFE_EXTENSIONS = /\.(?:css|js|mjs|png|jpe?g|webp|avif|svg|ico|woff2?|webmanifest)$/i;
const PRIVATE_PATH =
  /^\/(?:api|v1|app|admin|login|criar-conta|verificar-email|recuperar-senha)(?:\/|$)/;
const SENSITIVE_QUERY = /^(?:token|code|state|session|authorization)$/i;

export function isSafeAssetRequest(request, origin) {
  if (request.method !== "GET" || request.mode === "navigate") return false;
  const url = new URL(request.url);
  if (url.origin !== origin || PRIVATE_PATH.test(url.pathname)) return false;
  if ([...url.searchParams.keys()].some((key) => SENSITIVE_QUERY.test(key))) return false;
  if (request.headers?.get?.("authorization")) return false;
  return SAFE_DESTINATIONS.has(request.destination) || SAFE_EXTENSIONS.test(url.pathname);
}

export function canCacheResponse(response) {
  if (!response.ok || !["basic", "default"].includes(response.type)) return false;
  const cacheControl = response.headers.get("cache-control") ?? "";
  return (
    !/(?:private|no-store)/i.test(cacheControl) &&
    !response.headers.has("set-cookie") &&
    response.headers.get("vary") !== "*"
  );
}

export function isFreshResponse(response, now, ttlMs) {
  const cachedAt = Number(response.headers.get("x-giromesa-cached-at"));
  return Number.isFinite(cachedAt) && cachedAt > 0 && now - cachedAt <= ttlMs;
}

export function stampCachedResponse(response, now = Date.now()) {
  const headers = new Headers(response.headers);
  headers.set("x-giromesa-cached-at", String(now));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
