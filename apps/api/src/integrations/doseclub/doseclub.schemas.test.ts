import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { doseClubV1SaleSchema, doseClubV2OperationSchema } from "./doseclub.schemas.js";

const snapshot = {
  volumeMlAtPurchase: 700,
  doseMlAtPurchase: 50,
  totalDoses: 14,
  remainingDoses: 14,
};

function sale(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "v2",
    operation: "sale",
    operationId: "order-01",
    idempotencyKey: "sale:order-01",
    occurredAt: "2026-08-11T18:00:00.000Z",
    version: 1,
    branchId: "branch-centro",
    externalClubId: "membership-01",
    externalOfferId: "offer-01",
    saleType: "individual",
    productId: "whisky-01",
    quantityBottles: 1,
    purchaseSnapshot: snapshot,
    ...overrides,
  };
}

describe("DoseClub receiver contracts", () => {
  it("accepts the canonical v2 sale and enforces operation-specific fields", () => {
    assert.equal(doseClubV2OperationSchema.parse(sale()).operation, "sale");
    assert.throws(() => doseClubV2OperationSchema.parse(sale({ version: 2 })), /version|sale/i);
    assert.throws(
      () =>
        doseClubV2OperationSchema.parse(
          sale({ saleType: "combo_pool", productId: undefined, eligibleProductIds: ["a", "a"] }),
        ),
      /eligibleProductIds|distinct/i,
    );
  });

  it("rejects inconsistent snapshots, unknown fields and malformed reconciliation", () => {
    assert.throws(() =>
      doseClubV2OperationSchema.parse(
        sale({ purchaseSnapshot: { ...snapshot, remainingDoses: 15 } }),
      ),
    );
    assert.throws(() => doseClubV2OperationSchema.parse(sale({ tenantId: "forged" })));
    assert.throws(() =>
      doseClubV2OperationSchema.parse(
        sale({
          operation: "reconcile",
          productId: "whisky-01",
          saleType: undefined,
          quantityBottles: undefined,
          externalOfferId: undefined,
          expectedRemainingDoses: 14,
          expectedReservedDoses: 0,
          localVersion: 0,
        }),
      ),
    );
  });

  it("keeps the legacy v1 sale strict and byte-compatible in shape", () => {
    const value = {
      branchId: "branch-centro",
      saleType: "individual",
      productId: "whisky-01",
      quantityBottles: 1,
      totalDoses: 14,
      doseMl: 50,
      externalClubId: "membership-01",
      externalOfferId: "offer-01",
      idempotencyKey: "sale:order-01",
    };
    assert.deepEqual(doseClubV1SaleSchema.parse(value), value);
    assert.throws(() => doseClubV1SaleSchema.parse({ ...value, organizationId: "forged" }));
    assert.throws(() =>
      doseClubV1SaleSchema.parse({
        ...value,
        totalDoses: 2_147_483_647,
        doseMl: 2_147_483_647,
      }),
    );
  });
});
