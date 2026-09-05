const LOCAL_ORIGINS = ["http://localhost:3100", "http://localhost:3101", "http://localhost:3102"];
const API_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

export function corsConfiguration(value = process.env.CORS_ORIGINS) {
  const origins = configuredOrigins(value);
  const exposedHeaders = ["x-request-id"];
  if (origins.includes("*")) {
    return { origin: "*" as const, credentials: false, exposedHeaders, methods: API_METHODS };
  }
  return { origin: origins, credentials: true, exposedHeaders, methods: API_METHODS };
}

export function configuredOrigins(
  value = process.env.CORS_ORIGINS,
  nodeEnv = process.env.NODE_ENV,
) {
  return value
    ? value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
    : nodeEnv === "production"
      ? []
      : LOCAL_ORIGINS;
}

export function isAllowedRealtimeOrigin(
  origin: string | undefined,
  value = process.env.CORS_ORIGINS,
  nodeEnv = process.env.NODE_ENV,
) {
  if (!origin) return false;
  const origins = configuredOrigins(value, nodeEnv);
  return !origins.includes("*") && origins.includes(origin);
}

export function configuredTrustProxy(
  value = process.env.TRUST_PROXY,
  nodeEnv = process.env.NODE_ENV,
): boolean | string | string[] {
  const normalized = value?.trim();
  if (!normalized || normalized === "false") return false;
  if (normalized === "true") {
    if (nodeEnv === "production") {
      throw new Error("TRUST_PROXY=true is unsafe in production; configure trusted hops or CIDRs");
    }
    return true;
  }
  if (/^\d+$/.test(normalized)) {
    throw new Error("TRUST_PROXY hop counts are unsafe; configure trusted addresses or CIDRs");
  }
  const proxies = normalized
    .split(",")
    .map((proxy) => proxy.trim())
    .filter(Boolean);
  return proxies.length === 1 ? (proxies[0] ?? false) : proxies;
}
