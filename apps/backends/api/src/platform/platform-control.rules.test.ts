import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { platformIncidentImpact } from "./platform-control.service.js";

describe("platform incident impact", () => {
  it("deriva impacto apenas da origem e do tópico persistido", () => {
    assert.deepEqual(platformIncidentImpact({ source: "billing", detail: {} }), {
      impact: "billing",
      criterion: "origem cobrança",
    });
    assert.deepEqual(
      platformIncidentImpact({ source: "outbox", detail: { topic: "growth.delivery_dispatched" } }),
      { impact: "orders", criterion: "tópico growth.delivery_dispatched" },
    );
    assert.deepEqual(
      platformIncidentImpact({ source: "outbox", detail: { topic: "growth.whatsapp_message" } }),
      { impact: "messaging", criterion: "tópico growth.whatsapp_message" },
    );
    assert.deepEqual(
      platformIncidentImpact({ source: "outbox", detail: { topic: "billing.sync" } }),
      { impact: "billing", criterion: "tópico billing.sync" },
    );
  });
});
