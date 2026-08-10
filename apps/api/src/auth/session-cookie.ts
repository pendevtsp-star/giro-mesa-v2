export const SESSION_COOKIE_NAME = "giromesa_session";
export const GOOGLE_STATE_COOKIE_NAME = "giromesa_google_state";
export const OAUTH_MFA_COOKIE_NAME = "giromesa_oauth_mfa";

export function isProduction() {
  return process.env.NODE_ENV === "production";
}

export function sessionCookieOptions(expiresAt: Date, now = new Date()) {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax" as const,
    path: "/",
    maxAge: Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1_000)),
  };
}

export function clearSessionCookieOptions() {
  return { httpOnly: true, secure: isProduction(), sameSite: "lax" as const, path: "/" };
}

export function shortLivedAuthCookieOptions(maxAge = 10 * 60) {
  return { httpOnly: true, secure: isProduction(), sameSite: "lax" as const, path: "/", maxAge };
}
