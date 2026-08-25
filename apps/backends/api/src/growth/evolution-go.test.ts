import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EvolutionGoClient, EvolutionGoError } from "./evolution-go.js";

const environment = {
  WHATSAPP_EVOLUTION_API_URL: "http://evolution-go:4000",
  WHATSAPP_EVOLUTION_GLOBAL_API_KEY: "global-key",
  WHATSAPP_EVOLUTION_TOKEN_SECRET: "s".repeat(32),
  WHATSAPP_EVOLUTION_WEBHOOK_URL: "http://api:3200/v1/growth/evolution-go/webhook",
};

describe("Evolution Go client", () => {
  it("uses the 0.7.2 contract and only trusts LoggedIn as ready", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ data: { Connected: true, LoggedIn: false } }));
    };
    const client = new EvolutionGoClient("integration", "unit-id", { environment, fetcher });
    assert.deepEqual(await client.status(), {
      state: "connecting",
      ready: false,
      connectedNumber: null,
    });
    await client.connect();
    assert.equal(calls[0]?.url, "http://evolution-go:4000/instance/status");
    assert.equal(calls[1]?.url, "http://evolution-go:4000/instance/connect");
    assert.equal(new Headers(calls[1]?.init?.headers).get("apikey"), client.token);
  });

  it("marks ambiguous send failures separately from safe lifecycle retries", async () => {
    const fetcher: typeof fetch = async () => {
      throw new TypeError("network");
    };
    const client = new EvolutionGoClient("integration", "unit-id", { environment, fetcher });
    await assert.rejects(client.status(), (error) => {
      assert.ok(error instanceof EvolutionGoError);
      assert.equal(error.retryable, true);
      assert.equal(error.deliveryUncertain, false);
      return true;
    });
  });

  it("downloads bounded media and supports the compatible fallback endpoint", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      calls.push(String(input));
      if (calls.length === 1)
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      return new Response(JSON.stringify({ data: { base64: "JVBERi0xLjQ=" } }));
    };
    const client = new EvolutionGoClient("integration", "unit-id", { environment, fetcher });
    assert.equal(await client.downloadMedia({ documentMessage: {} }), "JVBERi0xLjQ=");
    assert.deepEqual(calls, [
      "http://evolution-go:4000/message/downloadimage",
      "http://evolution-go:4000/message/downloadmedia",
    ]);
  });
});
