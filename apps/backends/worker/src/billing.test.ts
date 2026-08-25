import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextBillingPeriod, resolvedChargeStatus } from "./billing.js";

describe("billing worker periods", () => {
  it("preserves the billing day and clamps month-end dates", () => {
    assert.equal(
      nextBillingPeriod(new Date("2026-01-31T12:00:00.000Z"), "monthly").toISOString(),
      "2026-02-28T12:00:00.000Z",
    );
    assert.equal(
      nextBillingPeriod(new Date("2024-02-29T12:00:00.000Z"), "annual").toISOString(),
      "2025-02-28T12:00:00.000Z",
    );
  });
});

describe("billing webhook ordering", () => {
  it("does not regress paid charges but accepts a later refund", () => {
    assert.equal(resolvedChargeStatus("paid", "overdue"), "paid");
    assert.equal(resolvedChargeStatus("paid", "refunded"), "refunded");
    assert.equal(resolvedChargeStatus("refunded", "paid"), "refunded");
  });
});
