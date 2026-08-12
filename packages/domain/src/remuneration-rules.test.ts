import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  evaluateRemunerationRule,
  freezeRemunerationCalculation,
  type RemunerationRuleVersion,
  selectEffectiveRemunerationRule,
  simulateRemunerationRule,
} from "./remuneration-rules.js";

const rule: RemunerationRuleVersion = {
  ruleSetId: "service-team",
  version: 2,
  kind: "service",
  effectiveFrom: "2026-08-01T00:00:00.000Z",
  effectiveUntil: null,
  expression: {
    type: "min",
    operands: [
      {
        type: "basis_points",
        basisPoints: 1_500,
        rounding: "down",
        operand: { type: "metric", metric: "serviceChargeCents" },
      },
      { type: "constant", value: 50_000 },
    ],
  },
};

describe("typed remuneration rule engine", () => {
  it("evaluates integer cents deterministically and exposes a simulation trace", () => {
    const metrics = {
      grossSalesCents: 1_000_000,
      netSalesCents: 900_000,
      serviceChargeCents: 100_001,
      eligibleSalesCents: 800_000,
      profitCents: 120_000,
      hoursMinutes: 2_400,
      unitsSold: 80,
    } as const;
    assert.equal(evaluateRemunerationRule(rule.expression, metrics), 15_000);
    const simulation = simulateRemunerationRule(rule, metrics);
    assert.equal(simulation.outputCents, 15_000);
    assert.ok(simulation.trace.length >= 3);
  });

  it("selects one effective version and rejects overlap", () => {
    const old = {
      ...rule,
      version: 1,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveUntil: "2026-08-01T00:00:00.000Z",
    };
    assert.equal(
      selectEffectiveRemunerationRule([old, rule], "2026-07-31T23:59:59.999Z")?.version,
      1,
    );
    assert.equal(
      selectEffectiveRemunerationRule([old, rule], "2026-08-01T00:00:00.000Z")?.version,
      2,
    );
    assert.throws(() =>
      selectEffectiveRemunerationRule([rule, { ...rule, version: 3 }], "2026-08-02T00:00:00.000Z"),
    );
  });

  it("freezes the rule, inputs, sources and output into immutable memory", () => {
    const frozen = freezeRemunerationCalculation(
      rule,
      {
        grossSalesCents: 0,
        netSalesCents: 0,
        serviceChargeCents: 10_000,
        eligibleSalesCents: 0,
        profitCents: 0,
        hoursMinutes: 0,
        unitsSold: 0,
      },
      ["ledger:closing-2026-08"],
      "2026-09-01T03:00:00.000Z",
    );
    assert.equal(frozen.outputCents, 1_500);
    assert.equal(Object.isFrozen(frozen), true);
    assert.equal(Object.isFrozen(frozen.rule.expression), true);
    assert.match(frozen.memoryHash, /^[a-f0-9]{64}$/);
  });

  it("contains no dynamic code execution escape hatch", () => {
    const source = readFileSync(new URL("./remuneration-rules.js", import.meta.url), "utf8");
    assert.equal(/\beval\s*\(|new\s+Function\b|node:vm/.test(source), false);
  });
});
