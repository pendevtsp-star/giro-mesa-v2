import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { billingCheckoutInputSchema } from "@giromesa/contracts";
import { secretsMatch } from "./asaas-webhook.guard.js";
import {
  cyclePriceCents,
  isHttpsUrl,
  proratedUpgrade,
  sameCheckoutRequest,
  UPGRADE_QUOTE_MINUTES,
} from "./billing.rules.js";

describe("billing boundaries", () => {
  it("rounds prorata once using the exact remaining time", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = new Date("2026-01-31T00:00:00.000Z");
    assert.deepEqual(proratedUpgrade(10_000, 20_001, start, end, start), {
      amountCents: 10_001,
      remainingRatio: 1,
    });
    assert.deepEqual(
      proratedUpgrade(10_000, 20_001, start, end, new Date("2026-01-16T00:00:00.000Z")),
      { amountCents: 5_001, remainingRatio: 0.5 },
    );
    assert.throws(() => proratedUpgrade(10_000, 20_001, start, end, new Date(end.getTime() - 1)));
    assert.equal(UPGRADE_QUOTE_MINUTES, 15);
    assert.equal(cyclePriceCents(10_000, 100_000, "monthly"), 10_000);
    assert.equal(cyclePriceCents(10_000, 100_000, "annual"), 100_000);
  });

  it("requires a discriminated checkout and validates the webhook secret", () => {
    assert.equal(
      billingCheckoutInputSchema.safeParse({
        intent: "subscribe",
        planSlug: "pro",
        cycle: "monthly",
      }).success,
      true,
    );
    assert.equal(
      billingCheckoutInputSchema.safeParse({ intent: "upgrade", planSlug: "pro" }).success,
      false,
    );
    assert.equal(secretsMatch("0123456789", "0123456789"), true);
    assert.equal(secretsMatch("0123456789", "0123456780"), false);
  });

  it("rejects reuse of an idempotency key with different content", () => {
    const stored = {
      intent: "subscribe",
      targetPlanId: "plan-pro",
      amountCents: 20_000,
      cycle: "monthly",
      upgradeQuoteId: null,
    };
    assert.equal(sameCheckoutRequest(stored, stored), true);
    assert.equal(sameCheckoutRequest(stored, { ...stored, targetPlanId: "plan-max" }), false);
    assert.equal(sameCheckoutRequest(stored, { ...stored, cycle: "annual" }), false);
  });

  it("accepts only HTTPS checkout URLs", () => {
    assert.equal(isHttpsUrl("https://sandbox.asaas.com/checkout/123"), true);
    assert.equal(isHttpsUrl("http://sandbox.asaas.com/checkout/123"), false);
    assert.equal(isHttpsUrl("not-a-url"), false);
  });
});
