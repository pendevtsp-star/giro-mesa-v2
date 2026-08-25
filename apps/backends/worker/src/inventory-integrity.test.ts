import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inventoryIntegrityStatus } from "./inventory-integrity.js";

describe("inventory integrity", () => {
  it("marks any persisted invariant mismatch for operational attention", () => {
    assert.deepEqual(
      inventoryIntegrityStatus({
        organizationId: "org",
        unitId: "unit",
        overcommittedBalances: 1,
        invalidTransfers: 0,
        negativeCustodies: 2,
        ledgerMismatches: 3,
      }),
      { mismatchCount: 6, status: "attention" },
    );
  });
});
