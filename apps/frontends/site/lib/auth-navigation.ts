export function resolveOpsUrl(
  configuredUrl: string | undefined,
  currentOrigin: string,
): string | null {
  if (!configuredUrl) return null;
  if (!configuredUrl.startsWith("/") && !/^https?:\/\//i.test(configuredUrl)) return null;
  try {
    const url = new URL(configuredUrl, currentOrigin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function resolveLocalReturnTo(value: string | null, currentOrigin: string): string | null {
  if (!value || value.length > 1_024 || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }
  try {
    const target = new URL(value, currentOrigin);
    return target.origin === currentOrigin
      ? `${target.pathname}${target.search}${target.hash}`
      : null;
  } catch {
    return null;
  }
}

export async function prepareGoogleRedirect(
  apiUrl: string,
  input: {
    intent: "login" | "signup";
    termsAccepted?: boolean;
    returnTo?: string;
  },
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  const response = await fetcher(`${apiUrl}/v1/auth/google/prepare`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { authorizationUrl?: unknown };
  if (typeof payload.authorizationUrl !== "string") return null;
  try {
    const target = new URL(payload.authorizationUrl);
    return target.protocol === "https:" &&
      target.hostname === "accounts.google.com" &&
      target.pathname === "/o/oauth2/v2/auth"
      ? target.toString()
      : null;
  } catch {
    return null;
  }
}
