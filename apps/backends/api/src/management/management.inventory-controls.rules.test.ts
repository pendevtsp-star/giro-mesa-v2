import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dynamicSectorReplenishment,
  inventoryConfidence,
  productionVariance,
  temperatureStatus,
} from "./management.inventory-controls.rules.js";

describe("inventory operational controls", () => {
  it("classifies temperature, protects inbound stock and exposes operational confidence", () => {
    assert.equal(temperatureStatus(5_000, 0, 4_000), "warning");
    assert.equal(temperatureStatus(7_000, 0, 4_000), "critical");
    assert.equal(
      dynamicSectorReplenishment({
        current: 5,
        inbound: 3,
        minimum: 8,
        configuredTarget: 12,
        dailyDemand: 4,
        coverageDays: 2,
        sourceSurplus: 20,
      }),
      8,
    );
    assert.deepEqual(
      inventoryConfidence({
        countedExpected: 100,
        countAbsoluteDifference: 2,
        transferred: 50,
        transferDivergent: 1,
        outbound: 200,
        losses: 2,
      }),
      {
        score: 98,
        level: "high",
        countAccuracyPercent: 98,
        transferAccuracyPercent: 98,
        lossRatePercent: 1,
      },
    );
    assert.equal(productionVariance(100, 92), -8);
  });
});
