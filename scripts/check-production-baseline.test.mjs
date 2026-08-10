import assert from "node:assert/strict";
import test from "node:test";

import { validateProductionBaseline } from "./check-production-baseline.mjs";

const validBaseline = {
  level: "not-assessed",
  artifact: "source-tree",
  migration: "not-assessed",
  gateResults: {
    automated: "not-run",
    external: "not-run",
  },
};

test("accepts a release baseline with all required evidence", () => {
  assert.deepEqual(validateProductionBaseline(validBaseline), []);
});

for (const [field, baseline] of [
  ["level", { ...validBaseline, level: "" }],
  ["artifact", { ...validBaseline, artifact: "" }],
  ["migration", { ...validBaseline, migration: "" }],
  ["gate results", { ...validBaseline, gateResults: {} }],
]) {
  test(`rejects a release baseline without ${field}`, () => {
    assert.equal(validateProductionBaseline(baseline).length, 1);
  });
}
