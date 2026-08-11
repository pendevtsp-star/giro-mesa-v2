import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyYield,
  convertQuantity,
  effectiveVersion,
  formatQuantity,
  parseQuantity,
} from "./quantities.js";

describe("dimension-safe fixed precision quantities", () => {
  it("converts explicitly without floating point", () => {
    const liters = parseQuantity("0.333333", "l");
    const milliliters = convertQuantity(liters, "ml", "exact");
    assert.equal(formatQuantity(milliliters), "333.333000");
    assert.equal(milliliters.dimension, "volume");
  });

  it("rejects incompatible dimensions and precision beyond six decimals", () => {
    assert.throws(() => convertQuantity(parseQuantity("1", "kg"), "ml", "exact"));
    assert.throws(() => parseQuantity("0.0000001", "l"));
  });

  it("applies yield by rounding required input upward", () => {
    const net = parseQuantity("0.500000", "kg");
    assert.equal(formatQuantity(applyYield(net, 9_000)), "0.555556");
  });

  it("rounds negative half-up conversions away from zero", () => {
    const milligrams = parseQuantity("-0.0005", "mg");
    assert.equal(formatQuantity(convertQuantity(milligrams, "g", "half_up")), "-0.000001");
  });

  it("selects one effective-dated technical sheet", () => {
    const versions = [
      { version: 1, validFrom: "2026-01-01T00:00:00.000Z", validUntil: "2026-06-01T00:00:00.000Z" },
      { version: 2, validFrom: "2026-06-01T00:00:00.000Z", validUntil: null },
    ];
    assert.equal(effectiveVersion(versions, "2026-05-31T23:59:59.999Z")?.version, 1);
    assert.equal(effectiveVersion(versions, "2026-06-01T00:00:00.000Z")?.version, 2);
  });
});
