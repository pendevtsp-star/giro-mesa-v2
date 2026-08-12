import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  ASSET_TTL_MS,
  canCacheResponse,
  fetchRuntimeAsset,
  isFreshResponse,
  isSafeAssetRequest,
} from "./pwa-cache-policy.js";

describe("política de cache PWA", () => {
  it("mantém a mesma política restritiva nos três aplicativos", async () => {
    const files = await Promise.all(
      [
        "./pwa-cache-policy.js",
        "../../site/public/pwa-cache-policy.js",
        "../../customer/public/pwa-cache-policy.js",
      ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    );
    expect(new Set(files).size).toBe(1);
  });

  it("aceita somente paths públicos conhecidos, sem query, credenciais ou navegação", () => {
    const origin = "https://ops.giromesa.test";
    expect(
      isSafeAssetRequest(
        {
          method: "GET",
          mode: "cors",
          destination: "script",
          url: `${origin}/assets/app-deadbeef.js`,
        },
        origin,
      ),
    ).toBe(true);
    expect(
      isSafeAssetRequest(
        { method: "GET", mode: "cors", destination: "script", url: `${origin}/assets/app.js` },
        origin,
      ),
    ).toBe(false);
    expect(
      isSafeAssetRequest(
        {
          method: "GET",
          mode: "cors",
          destination: "script",
          url: `${origin}/profile/export.js`,
        },
        origin,
      ),
    ).toBe(false);
    expect(
      isSafeAssetRequest(
        {
          method: "GET",
          mode: "cors",
          destination: "image",
          url: `${origin}/images/product/dashboard.png?user=42`,
        },
        origin,
      ),
    ).toBe(false);
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

  it("exige Cache-Control public explícito e expira rigidamente em sete dias", () => {
    expect(canCacheResponse(new Response("sem política", { status: 200 }))).toBe(false);
    expect(
      canCacheResponse(
        new Response("público", {
          status: 200,
          headers: { "cache-control": "public, max-age=604800" },
        }),
      ),
    ).toBe(true);
    expect(
      canCacheResponse(
        new Response("privado", {
          headers: { "cache-control": "public, private, max-age=604800" },
        }),
      ),
    ).toBe(false);
    const now = Date.parse("2026-08-11T12:00:00.000Z");
    expect(
      isFreshResponse(
        new Response("asset", { headers: { "x-giromesa-cached-at": String(now - 1_000) } }),
        now,
        ASSET_TTL_MS,
      ),
    ).toBe(true);
    expect(
      isFreshResponse(
        new Response("asset", {
          headers: { "x-giromesa-cached-at": String(now - ASSET_TTL_MS - 1) },
        }),
        now,
        ASSET_TTL_MS,
      ),
    ).toBe(false);
  });

  it("remove asset expirado e nunca o devolve em stale-if-error", async () => {
    const now = Date.parse("2026-08-11T12:00:00.000Z");
    const request = new Request("https://ops.giromesa.test/assets/app-deadbeef.js", {
      credentials: "include",
    });
    const cached = new Response("antigo", {
      headers: { "x-giromesa-cached-at": String(now - ASSET_TTL_MS - 1) },
    });
    let deleted = false;
    const cache = {
      match: async () => cached,
      delete: async () => {
        deleted = true;
        return true;
      },
      put: async () => undefined,
    };

    await expect(
      fetchRuntimeAsset(
        request,
        cache,
        async () => {
          throw new Error("offline");
        },
        now,
      ),
    ).rejects.toThrow("offline");
    expect(deleted).toBe(true);
  });

  it("busca assets públicos sem cookies e armazena apenas respostas públicas", async () => {
    const request = new Request("https://ops.giromesa.test/assets/app-deadbeef.js", {
      credentials: "include",
    });
    let fetchedRequest;
    let stored = false;
    const cache = {
      match: async () => undefined,
      delete: async () => false,
      put: async () => {
        stored = true;
      },
    };

    const response = await fetchRuntimeAsset(
      request,
      cache,
      async (publicRequest) => {
        fetchedRequest = publicRequest;
        return new Response("novo", {
          status: 200,
          headers: { "cache-control": "public, max-age=604800" },
        });
      },
      Date.parse("2026-08-11T12:00:00.000Z"),
    );

    expect(await response.text()).toBe("novo");
    expect(fetchedRequest.credentials).toBe("omit");
    expect(stored).toBe(true);
  });
});
