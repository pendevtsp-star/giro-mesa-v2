import assert from "node:assert/strict";
import { it } from "node:test";
import { getPwaMutationCount } from "@giromesa/ui/pwa-mutation";
import { customerFetch } from "./pwa-fetch.ts";

it("mantém a mutação HTTP do Customer ativa até a resposta", async () => {
  const originalFetch = globalThis.fetch;
  let finish: ((response: Response) => void) | undefined;
  globalThis.fetch = () =>
    new Promise<Response>((resolve) => {
      finish = resolve;
    });

  try {
    const pending = customerFetch("https://api.example.test/public/v1/orders", { method: "POST" });
    assert.equal(getPwaMutationCount(), 1);
    finish?.(new Response(null, { status: 204 }));
    await pending;
    assert.equal(getPwaMutationCount(), 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
