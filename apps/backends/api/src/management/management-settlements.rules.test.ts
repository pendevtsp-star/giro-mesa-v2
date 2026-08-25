import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocateCents,
  defaultSettlementConfig,
  normalizeSettlementConfig,
  partnershipRewardCents,
  settlementPayableCents,
  teamServiceShareCents,
  validatePartnershipTiers,
} from "./management-settlements.rules.js";
import {
  settlementConfigSchema,
  settlementPeriodSchema,
} from "./management-settlements.schemas.js";

const tiers = [
  { minimumCents: 0, maximumCents: 2_999_999, rewardType: "percentage" as const, rewardValue: 0 },
  {
    minimumCents: 3_000_000,
    maximumCents: 3_999_999,
    rewardType: "percentage" as const,
    rewardValue: 100,
  },
  {
    minimumCents: 4_000_000,
    maximumCents: null,
    rewardType: "percentage" as const,
    rewardValue: 200,
  },
];

describe("waiter settlement rules", () => {
  it("calculates whole-base and progressive partnership tiers", () => {
    assert.equal(partnershipRewardCents(4_500_000, tiers, "all_revenue"), 90_000);
    assert.equal(partnershipRewardCents(4_500_000, tiers, "progressive"), 20_000);
  });

  it("rejects gaps and keeps operational losses outside the payable formula", () => {
    assert.throws(() =>
      validatePartnershipTiers([
        { minimumCents: 0, maximumCents: 100, rewardType: "fixed", rewardValue: 10 },
        { minimumCents: 102, maximumCents: null, rewardType: "fixed", rewardValue: 20 },
      ]),
    );
    assert.equal(teamServiceShareCents(10_000, 8_000), 8_000);
    assert.equal(settlementPayableCents(8_000, 2_000), 10_000);
  });

  it("allocates every cent deterministically", () => {
    const result = allocateCents(10, [
      { key: "b", weight: 1 },
      { key: "a", weight: 1 },
      { key: "c", weight: 1 },
    ]);
    assert.deepEqual(
      [...result.entries()],
      [
        ["a", 4],
        ["b", 3],
        ["c", 3],
      ],
    );
  });

  it("rejects invalid calendar dates at the API boundary", () => {
    assert.equal(
      settlementPeriodSchema.safeParse({ from: "2026-02-30", to: "2026-03-01" }).success,
      false,
    );
  });

  it("applies safe service-charge defaults to legacy configurations", () => {
    const {
      serviceChargeEnabled: _enabled,
      defaultServiceChargeBasisPoints: _rate,
      serviceChargeApplication: _application,
      ...legacy
    } = defaultSettlementConfig;
    const normalized = normalizeSettlementConfig(legacy);

    assert.equal(normalized.serviceChargeEnabled, false);
    assert.equal(normalized.defaultServiceChargeBasisPoints, 0);
    assert.equal(normalized.serviceChargeApplication, "manual");
    assert.equal(normalized.attributionMode, legacy.attributionMode);
  });

  it("requires a positive default rate when service charge is enabled", () => {
    assert.equal(
      settlementConfigSchema.safeParse({ ...defaultSettlementConfig, serviceChargeEnabled: true })
        .success,
      false,
    );
    assert.equal(
      settlementConfigSchema.safeParse({
        ...defaultSettlementConfig,
        serviceChargeEnabled: true,
        defaultServiceChargeBasisPoints: 1_000,
      }).success,
      true,
    );
  });
});
