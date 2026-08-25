import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { paymentEvents } from "@giromesa/db";
import { UnauthorizedException } from "@nestjs/common";
import { AsaasWebhookGuard } from "./asaas-webhook.guard.js";
import { BillingService } from "./billing.service.js";

describe("Asaas webhook", () => {
  it("rejects an invalid access token", () => {
    const previous = process.env.ASAAS_WEBHOOK_SECRET;
    process.env.ASAAS_WEBHOOK_SECRET = "expected-webhook-secret";
    try {
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ headers: { "asaas-access-token": "invalid-webhook-secret" } }),
        }),
      };
      assert.throws(
        () => new AsaasWebhookGuard().canActivate(context as never),
        UnauthorizedException,
      );
    } finally {
      if (previous === undefined) delete process.env.ASAAS_WEBHOOK_SECRET;
      else process.env.ASAAS_WEBHOOK_SECRET = previous;
    }
  });

  it("acknowledges a duplicate without publishing another outbox event", async () => {
    let outboxInserts = 0;
    const tx = {
      insert: (table: unknown) => ({
        values: () => {
          if (table === paymentEvents) {
            return {
              onConflictDoNothing: () => ({ returning: async () => [] }),
            };
          }
          outboxInserts += 1;
          return Promise.resolve();
        },
      }),
    };
    const database = { db: { transaction: (work: (value: typeof tx) => unknown) => work(tx) } };
    const service = new BillingService(database as never, {} as never);
    const result = await service.receiveAsaasWebhook({
      id: "evt_duplicate",
      event: "CHECKOUT_PAID",
    });
    assert.deepEqual(result, { received: true, duplicate: true });
    assert.equal(outboxInserts, 0);
  });
});
