import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accountingNotificationMessage } from "./accounting-notification.js";

describe("accounting request notification", () => {
  it("builds a retry-safe message without request details", () => {
    const message = accountingNotificationMessage(
      "accounting.request.created",
      "event-id",
      {
        identityId: "identity-id",
        displayName: "Ana Contadora",
        email: "ana@example.test",
      },
      "Restaurante Exemplo",
      "https://app.example.test",
    );
    assert.equal(message.idempotencyKey, "accounting-request/created/event-id/identity-id");
    assert.match(message.text, /https:\/\/app\.example\.test\/#\/accountant/);
    assert.doesNotMatch(JSON.stringify(message), /descrição reservada|resposta reservada/i);
  });
});
