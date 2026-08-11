import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { remunerationVersionSchema } from "./remuneration.schemas.js";

function version(expression: unknown) {
  return { expression, effectiveFrom: "2026-09-01T00:00:00.000Z" };
}

describe("remuneration expression schema", () => {
  it("accepts only the closed expression DSL", () => {
    assert.equal(
      remunerationVersionSchema.safeParse(
        version({
          type: "basis_points",
          operand: { type: "metric", metric: "eligibleSalesCents" },
          basisPoints: 500,
          rounding: "down",
        }),
      ).success,
      true,
    );
    assert.equal(
      remunerationVersionSchema.safeParse(version({ type: "eval", code: "return 1" })).success,
      false,
    );
    assert.equal(
      remunerationVersionSchema.safeParse(version({ type: "constant", value: 1, code: "extra" }))
        .success,
      false,
    );
    assert.equal(
      remunerationVersionSchema.safeParse(
        version({ type: "constant", value: Number.MAX_SAFE_INTEGER + 1 }),
      ).success,
      false,
    );
  });

  it("bounds recursive depth and total nodes", () => {
    let deep: unknown = { type: "constant", value: 1 };
    for (let index = 0; index < 34; index += 1) {
      deep = { type: "add", operands: [deep] };
    }
    assert.equal(remunerationVersionSchema.safeParse(version(deep)).success, false);
    assert.equal(
      remunerationVersionSchema.safeParse(
        version({
          type: "add",
          operands: Array.from({ length: 64 }, () => ({
            type: "add",
            operands: Array.from({ length: 5 }, () => ({ type: "constant", value: 1 })),
          })),
        }),
      ).success,
      false,
    );
  });
});
