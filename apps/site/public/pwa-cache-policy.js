export const ASSET_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

const STATIC_PATHS = [
  {
    pattern:
      /^\/assets\/(?:[^/]+\/)*[^/]+-[a-z0-9_-]{6,}\.(?:css|js|mjs|png|jpe?g|webp|avif|svg|ico|woff2?)$/i,
    destinations: new Set(["style", "script", "image", "font"]),
  },
  {
    pattern: /^\/_next\/static\/.+/,
    destinations: new Set(["style", "script", "image", "font"]),
  },
  {
    pattern: /^\/images\/product\/.+\.(?:png|jpe?g|webp|avif|svg)$/i,
    destinations: new Set(["image"]),
  },
  {
    pattern: /^\/icons\/pwa-(?:192|512)\.svg$/,
    destinations: new Set(["image"]),
  },
];

export function isSafeAssetRequest(request, origin) {
  if (request.method !== "GET" || request.mode === "navigate") return false;
  const url = new URL(request.url);
  if (url.origin !== origin || url.search || url.hash) return false;
  if (request.headers?.get?.("authorization")) return false;
  return STATIC_PATHS.some(
    ({ pattern, destinations }) =>
      pattern.test(url.pathname) && destinations.has(request.destination),
  );
}

export function canCacheResponse(response) {
  if (!response.ok || !["basic", "default"].includes(response.type)) return false;
  const cacheControl = response.headers.get("cache-control") ?? "";
  const directives = cacheControl.split(",").map((directive) => directive.trim().toLowerCase());
  return (
    directives.includes("public") &&
    !directives.some((directive) => /^(?:private|no-store|no-cache)(?:=|$)/.test(directive)) &&
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

export async function fetchRuntimeAsset(
  request,
  cache,
  fetcher = globalThis.fetch,
  now = Date.now(),
) {
  const cached = await cache.match(request);
  if (cached && isFreshResponse(cached, now, ASSET_TTL_MS)) return cached;
  if (cached) await cache.delete(request);

  const publicRequest = new Request(request, { cache: "reload", credentials: "omit" });
  const response = await fetcher(publicRequest);
  if (canCacheResponse(response)) {
    await cache.put(request, stampCachedResponse(response.clone(), now));
  }
  return response;
}
