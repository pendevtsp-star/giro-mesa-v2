import assert from "node:assert/strict";
import test from "node:test";
import { validateSupplyChain, validateWorkflowBuildArgs } from "./check-supply-chain.mjs";

test("supply-chain configuration meets the local release contract", () => {
  assert.deepEqual(validateSupplyChain(), []);
});

test("rejects GitHub secrets and sensitive build-arg names", () => {
  const errors = validateWorkflowBuildArgs(`
    build-args: |
      API_TOKEN=\${{ secrets.API_TOKEN }}
      PUBLIC_VALUE=safe
  `);

  assert.deepEqual(errors, ["workflow build arguments must not carry secrets or sensitive values"]);
});
