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
  "email-verification/request",
  "email-verification/confirm",
]);

const AUTH_RATE_LIMITS: Record<string, { bucket: string; max: number }> = {
  login: { bucket: "auth:login", max: 10 },
  register: { bucket: "auth:register", max: 5 },
  "mfa/challenge/verify": { bucket: "auth:mfa-challenge", max: 10 },
  "mfa/oauth/verify": { bucket: "auth:mfa-challenge", max: 10 },
  "mfa/disable": { bucket: "auth:mfa-management", max: 10 },
  "mfa/setup": { bucket: "auth:mfa-management", max: 10 },
  "mfa/setup/confirm": { bucket: "auth:mfa-management", max: 10 },
  "password/forgot": { bucket: "auth:password-reset-request", max: 5 },
  "password-reset/request": { bucket: "auth:password-reset-request", max: 5 },
  "password-reset/confirm": { bucket: "auth:password-reset-confirm", max: 10 },
  "email-verification/request": { bucket: "auth:email-verification-request", max: 10 },
  "email-verification/confirm": { bucket: "auth:email-verification-confirm", max: 10 },
};

function authEndpoint(url: string) {
  const path = new URL(url, "http://localhost").pathname.replace(/\/+$/, "");
  return path.match(/^\/(?:(?:api|public)\/)?v1\/auth\/(.+)$/)?.[1];
}

export function isSensitiveAuthRequest(url: string) {
  const endpoint = authEndpoint(url);
  return endpoint ? SENSITIVE_AUTH_ENDPOINTS.has(endpoint) : false;
}

export function requestRateLimit(method: string, url: string) {
  const endpoint = authEndpoint(url);
  if (endpoint && SENSITIVE_AUTH_ENDPOINTS.has(endpoint)) {
    return AUTH_RATE_LIMITS[endpoint] ?? { bucket: `auth:${endpoint}`, max: 10 };
  }
  const path = new URL(url, "http://localhost").pathname.replace(/\/+$/, "");
  if (/^\/(?:api\/)?v1\/integrations\/club-whisky(?:\/|$)/.test(path)) {
    return { bucket: "integration:doseclub", max: 6_000 } as const;
  }
  if (
    method.toUpperCase() === "POST" &&
    (/^\/(?:api\/v1\/public|public\/v1)\/menus\/[^/]+\/(?:orders|reservations|waitlist|coupons\/validate)$/.test(
      path,
    ) ||
      /^\/(?:api\/v1\/public|public\/v1)\/(?:trial-applications|contact)$/.test(path))
  )
    return { bucket: "public-write", max: 20 } as const;
  return { bucket: "api", max: 100 } as const;
}

export const DOSECLUB_KEY_RATE_LIMIT = 600;

export function requestRateLimitKey(input: {
  method: string;
  url: string;
  ip: string;
  integrationKey?: string | string[];
}) {
  const policy = requestRateLimit(input.method, input.url);
  if (policy.bucket !== "integration:doseclub") return `${input.ip}:${policy.bucket}`;
  const rawKey = Array.isArray(input.integrationKey) ? undefined : input.integrationKey?.trim();
  if (!rawKey || !/^[\x21-\x7e]{32,256}$/.test(rawKey)) {
    return `${policy.bucket}:ip:${input.ip}`;
  }
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  return `${policy.bucket}:key:${keyHash}`;
}
import { createHash } from "node:crypto";
