import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deliverWhatsAppReady } from "./whatsapp.js";

describe("WhatsApp ready notification", () => {
  it("sends an approved template and returns only the provider reference", async () => {
    let requestBody = "";
    const result = await deliverWhatsAppReady(
      { to: "+5511999999999", reference: "014", idempotencyKey: "order-ready/event-1" },
      {
        configuration: {
          accessToken: "secret-token",
          phoneNumberId: "123456",
          graphApiVersion: "v24.0",
          template: "pedido_pronto",
          language: "pt_BR",
        },
        fetcher: async (_url, init) => {
          requestBody = String(init?.body);
          return new Response(JSON.stringify({ messages: [{ id: "wamid.provider-reference" }] }), {
            status: 200,
          });
        },
      },
    );

    assert.equal(result.providerReference, "wamid.provider-reference");
    const body = JSON.parse(requestBody) as Record<string, unknown>;
    assert.equal(body.messaging_product, "whatsapp");
    assert.equal(body.to, "5511999999999");
  });
});
