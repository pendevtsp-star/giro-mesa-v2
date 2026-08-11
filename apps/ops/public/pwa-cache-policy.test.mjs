import { describe, expect, it } from "vitest";
import { canCacheResponse, isFreshResponse, isSafeAssetRequest } from "./pwa-cache-policy.js";

describe("política de cache PWA", () => {
  it("aceita somente assets GET da mesma origem", () => {
    const origin = "https://ops.giromesa.test";
    expect(
      isSafeAssetRequest(
        { method: "GET", mode: "cors", destination: "script", url: `${origin}/assets/app.js` },
        origin,
      ),
    ).toBe(true);
    expect(
      isSafeAssetRequest(
        { method: "POST", mode: "cors", destination: "", url: `${origin}/api/orders` },
        origin,
      ),
    ).toBe(false);
    expect(
      isSafeAssetRequest(
        { method: "GET", mode: "navigate", destination: "document", url: `${origin}/app` },
        origin,
      ),
    ).toBe(false);
    expect(
      isSafeAssetRequest(
        { method: "GET", mode: "cors", destination: "script", url: "https://cdn.invalid/app.js" },
        origin,
      ),
    ).toBe(false);
  });

  it("nunca armazena resposta privada e expira pelo timestamp", () => {
    expect(canCacheResponse(new Response("ok", { status: 200 }))).toBe(true);
    expect(
      canCacheResponse(new Response("privado", { headers: { "set-cookie": "session=x" } })),
    ).toBe(false);
    const now = Date.parse("2026-08-11T12:00:00.000Z");
    expect(
      isFreshResponse(
        new Response("asset", { headers: { "x-giromesa-cached-at": String(now - 1_000) } }),
        now,
        2_000,
      ),
    ).toBe(true);
    expect(
      isFreshResponse(
        new Response("asset", { headers: { "x-giromesa-cached-at": String(now - 3_000) } }),
        now,
        2_000,
      ),
    ).toBe(false);
  });
});
