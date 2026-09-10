import { createHash } from "node:crypto";

const SENSITIVE_AUTH_ENDPOINTS = new Set([
  "login",
  "register",
  "mfa/challenge/verify",
  "mfa/oauth/verify",
  "mfa/disable",
  "mfa/setup",
  "mfa/setup/confirm",
  "password/forgot",
  "password-reset/request",
  "password-reset/confirm",
  "terminal-pin",
  "terminal-session",
  "terminal-session/unlock",
]);

export function isSensitiveAuthRequest(url: string) {
  const path = new URL(url, "http://localhost").pathname.replace(/\/+$/, "");
  const match = path.match(/^\/(?:(?:api|public)\/)?v1\/auth\/(.+)$/);
  return match ? SENSITIVE_AUTH_ENDPOINTS.has(match[1] ?? "") : false;
}

export function requestRateLimit(method: string, url: string) {
  if (isSensitiveAuthRequest(url)) return { bucket: "auth", max: 10 } as const;
  const path = new URL(url, "http://localhost").pathname.replace(/\/+$/, "");
  if (
    method.toUpperCase() === "POST" &&
    /^\/(?:api\/)?v1\/growth\/evolution-go\/webhook$/.test(path)
  )
    return { bucket: "evolution-webhook", max: 300 } as const;
  if (
    method.toUpperCase() === "POST" &&
    /^\/(?:api\/)?v1\/device\/edge-hub-pairings\/redeem$/.test(path)
  )
    return { bucket: "edge-hub-pairing", max: 10 } as const;
  if (
    method.toUpperCase() === "POST" &&
    /^\/(?:api\/v1\/public|public\/v1)\/menus\/[^/]+\/table-session$/.test(path)
  )
    return { bucket: "public-table-session", max: 10 } as const;
  if (
    method.toUpperCase() === "POST" &&
    /^\/(?:api\/v1\/public|public\/v1)\/menus\/[^/]+\/(?:commands|table-orders)$/.test(path)
  )
    return { bucket: "public-table-write", max: 30 } as const;
  if (
    method.toUpperCase() === "GET" &&
    /^\/(?:api\/v1\/public|public\/v1)\/menus\/[^/]+\/(?:consumption|table-session|table-orders\/[^/]+)$/.test(
      path,
    )
  )
    return { bucket: "public-table-read", max: 120 } as const;
  if (
    method.toUpperCase() === "POST" &&
    (/^\/(?:api\/v1\/public|public\/v1)\/menus\/[^/]+\/(?:orders|reservations|waitlist|coupons\/validate)$/.test(
      path,
    ) ||
      /^\/(?:api\/v1\/public|public\/v1)\/(?:trial-applications|contact)$/.test(path))
  )
    return { bucket: "public-write", max: 20 } as const;
  if (
    method.toUpperCase() === "GET" &&
    /^\/(?:api\/)?v1\/organizations\/[^/]+\/units\/[^/]+\/management\/reports(?:\/drill-down)?$/.test(
      path,
    )
  )
    return { bucket: "reports-read", max: 120 } as const;
  if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()))
    return { bucket: "api-read", max: 600 } as const;
  return { bucket: "api-write", max: 100 } as const;
}

export function requestRateLimitKey(bucket: string, ip: string, credential?: string) {
  const subject =
    sessionRateLimitBucket(bucket) && credential
      ? createHash("sha256").update(credential).digest("base64url").slice(0, 22)
      : ip;
  return `${subject}:${bucket}`;
}

export function operationalRateLimitBucket(bucket: string) {
  return bucket === "api-read" || bucket === "api-write" || bucket === "reports-read";
}

export function publicTableRateLimitSlug(url: string) {
  const path = new URL(url, "http://localhost").pathname.replace(/\/+$/, "");
  const match = path.match(
    /^\/(?:api\/v1\/public|public\/v1)\/menus\/([^/]+)\/(?:commands|consumption|table-session|table-orders(?:\/[^/]+)?)$/,
  );
  return match?.[1] ?? null;
}

function sessionRateLimitBucket(bucket: string) {
  return (
    operationalRateLimitBucket(bucket) ||
    bucket === "public-table-read" ||
    bucket === "public-table-write"
  );
}

export async function validatedRequestRateLimitKey(options: {
  bucket: string;
  ip: string;
  credential?: string | null;
  authenticate: (credential: string) => Promise<boolean>;
}) {
  if (!sessionRateLimitBucket(options.bucket) || !options.credential) {
    return requestRateLimitKey(options.bucket, options.ip);
  }
  try {
    const authenticated = await options.authenticate(options.credential);
    return requestRateLimitKey(
      options.bucket,
      options.ip,
      authenticated ? options.credential : undefined,
    );
  } catch {
    return requestRateLimitKey(options.bucket, options.ip);
  }
}
