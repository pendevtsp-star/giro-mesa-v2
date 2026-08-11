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
    (/^\/(?:api\/v1\/public|public\/v1)\/menus\/[^/]+\/(?:commands|orders|reservations|waitlist|coupons\/validate)$/.test(
      path,
    ) ||
      /^\/(?:api\/v1\/public|public\/v1)\/(?:trial-applications|contact)$/.test(path))
  )
    return { bucket: "public-write", max: 20 } as const;
  return { bucket: "api", max: 100 } as const;
}
