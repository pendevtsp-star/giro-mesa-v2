export function consumeEmailVerificationFragment(currentUrl: string) {
  const url = new URL(currentUrl);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const token = fragment.get("token");
  url.searchParams.delete("token");
  return {
    token,
    sanitizedUrl: `${url.pathname}${url.search}`,
  };
}

export function buildEmailVerificationRequest(apiUrl: string, token: string) {
  const endpoint = new URL(
    "/v1/auth/email-verification/confirm",
    apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`,
  );
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (endpoint.protocol !== "https:" && !loopbackHosts.has(endpoint.hostname)) {
    throw new Error("Email verification requires an HTTPS API endpoint");
  }
  return {
    url: endpoint.toString(),
    init: {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      referrerPolicy: "no-referrer",
      body: JSON.stringify({ token }),
    } satisfies RequestInit,
  };
}
