import assert from "node:assert/strict";
import test from "node:test";
import { validateSupplyChain } from "./check-supply-chain.mjs";

test("supply-chain configuration meets the local release contract", () => {
  assert.deepEqual(validateSupplyChain(), []);
});
