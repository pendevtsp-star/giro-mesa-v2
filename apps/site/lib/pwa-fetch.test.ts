import assert from "node:assert/strict";
import { it } from "node:test";
import { getPwaMutationCount } from "@giromesa/ui/pwa-mutation";
import { siteFetch } from "./pwa-fetch.ts";

it("mantém a mutação HTTP do Site ativa até a resposta", async () => {
  const originalFetch = globalThis.fetch;
  let finish: ((response: Response) => void) | undefined;
  globalThis.fetch = () =>
    new Promise<Response>((resolve) => {
      finish = resolve;
    });

  try {
    const pending = siteFetch("https://api.example.test/v1/auth/login", { method: "POST" });
    assert.equal(getPwaMutationCount(), 1);
    finish?.(new Response(null, { status: 204 }));
    await pending;
    assert.equal(getPwaMutationCount(), 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
