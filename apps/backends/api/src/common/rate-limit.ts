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
    (bucket === "reports-read" || bucket.startsWith("public-table-")) && credential
      ? createHash("sha256").update(credential).digest("base64url").slice(0, 22)
      : ip;
  return `${subject}:${bucket}`;
}
