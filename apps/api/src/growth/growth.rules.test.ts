import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSameOrganization,
  canTransition,
  couponDiscount,
  deliveryTransitions,
  hashOpaqueSecret,
  loyaltyEarn,
  marketingOptInAfter,
  payloadFingerprint,
  reservationTransitions,
  transferTransitions,
} from "./growth.rules.js";

describe("growth rules", () => {
  it("enforces reservation, delivery and transfer state machines", () => {
    assert.equal(canTransition(reservationTransitions, "confirmed", "seated"), true);
    assert.equal(canTransition(reservationTransitions, "completed", "booked"), false);
    assert.equal(canTransition(deliveryTransitions, "ready", "dispatched"), true);
    assert.equal(canTransition(deliveryTransitions, "completed", "canceled"), false);
    assert.equal(canTransition(transferTransitions, "in_transit", "received"), true);
  });

  it("calculates persisted loyalty and coupon values without floating money", () => {
    assert.equal(loyaltyEarn("points", 2, 1250, 0), 25);
    assert.equal(loyaltyEarn("cashback", 5, 1250, 0), 62);
    assert.equal(
      couponDiscount(
        {
          type: "percentage",
          value: 1500,
          minimumOrderCents: 1000,
          maximumDiscountCents: 1000,
        },
        10_000,
      ),
      1000,
    );
  });

  it("hashes API keys instead of preserving the bearer secret", () => {
    const secret = "gm_live_example-secret";
    const persisted = hashOpaqueSecret(secret);
    assert.notEqual(persisted, secret);
    assert.equal(persisted.length, 64);
  });

  it("derives marketing state from the latest append-only consent", () => {
    assert.equal(marketingOptInAfter("granted"), true);
    assert.equal(marketingOptInAfter("withdrawn"), false);
  });

  it("rejects cross-tenant resources", () => {
    assert.doesNotThrow(() => assertSameOrganization("org-a", "org-a"));
    assert.throws(() => assertSameOrganization("org-a", "org-b"), /CROSS_TENANT_RESOURCE/);
  });

  it("uses stable fingerprints to detect idempotency conflicts", () => {
    assert.equal(
      payloadFingerprint({ a: 1, nested: { b: 2 } }),
      payloadFingerprint({ nested: { b: 2 }, a: 1 }),
    );
    assert.notEqual(payloadFingerprint({ amount: 1 }), payloadFingerprint({ amount: 2 }));
  });
});
