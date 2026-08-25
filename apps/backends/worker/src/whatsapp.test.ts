import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deliverWhatsAppMedia, deliverWhatsAppReady } from "./whatsapp.js";

describe("Evolution Go WhatsApp delivery", () => {
  it("uses the pinned 0.7.2 text contract and returns only the provider reference", async () => {
    let requestBody = "";
    const result = await deliverWhatsAppReady(
      { to: "+5511999999999", reference: "014", idempotencyKey: "order-ready/event-1" },
      {
        configuration: {
          baseUrl: "http://evolution-go:4000",
          token: "secret-token",
        },
        fetcher: async (_url, init) => {
          requestBody = String(init?.body);
          return new Response(JSON.stringify({ data: { Info: { ID: "provider-reference" } } }), {
            status: 200,
          });
        },
      },
    );

    assert.equal(result.providerReference, "provider-reference");
    const body = JSON.parse(requestBody) as Record<string, unknown>;
    assert.equal(body.number, "5511999999999");
    assert.equal(body.id, "order-ready/event-1");
  });

  it("uses the Evolution Go media contract with an inline base64 payload", async () => {
    let requestBody = "";
    const result = await deliverWhatsAppMedia(
      {
        to: "5511999999999",
        text: "Comprovante",
        content: Buffer.from("%PDF-test"),
        fileName: "comprovante.pdf",
        mimeType: "application/pdf",
        type: "document",
        idempotencyKey: "crm/message-1",
      },
      {
        configuration: { baseUrl: "http://evolution-go:4000", token: "secret-token" },
        fetcher: async (_url, init) => {
          requestBody = String(init?.body);
          return new Response(JSON.stringify({ data: { Info: { ID: "provider-media" } } }));
        },
      },
    );

    assert.equal(result.providerReference, "provider-media");
    const body = JSON.parse(requestBody) as Record<string, unknown>;
    assert.equal(body.type, "document");
    assert.equal(body.filename, "comprovante.pdf");
    assert.match(String(body.url), /^data:application\/pdf;base64,/);
  });
});
