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
