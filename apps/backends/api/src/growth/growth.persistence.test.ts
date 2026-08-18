import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  couponRedemptions,
  customerConsents,
  deliveryOrders,
  growthCustomers,
  inventoryTransfers,
  loyaltyLedger,
  publicApiKeys,
  reservations,
  waitlistEntries,
  webhookEndpoints,
} from "@giromesa/db";

describe("growth persistence contract", () => {
  it("keeps tenant scope on every representative growth aggregate", () => {
    for (const table of [
      growthCustomers,
      customerConsents,
      loyaltyLedger,
      couponRedemptions,
      reservations,
      waitlistEntries,
      deliveryOrders,
      inventoryTransfers,
      publicApiKeys,
      webhookEndpoints,
    ])
      assert.ok(table.organizationId);
  });

  it("persists append-only consent and signed loyalty ledger entries", () => {
    assert.ok(customerConsents.occurredAt);
    assert.equal("updatedAt" in customerConsents, false);
    assert.ok(loyaltyLedger.amount);
    assert.ok(loyaltyLedger.reversalOfId);
  });

  it("stores fingerprints for strict idempotency", () => {
    for (const table of [
      loyaltyLedger,
      couponRedemptions,
      reservations,
      waitlistEntries,
      deliveryOrders,
      inventoryTransfers,
    ])
      assert.ok(table.requestFingerprint);
  });

  it("does not define clear-text API or webhook secret columns", () => {
    assert.ok(publicApiKeys.keyHash);
    assert.equal("key" in publicApiKeys, false);
    assert.equal("signingSecret" in webhookEndpoints, false);
  });
});
