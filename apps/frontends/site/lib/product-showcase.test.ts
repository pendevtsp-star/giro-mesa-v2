import assert from "node:assert/strict";
import test from "node:test";
import { productSwipeStep } from "./product-showcase.ts";

test("showcase changes slides only after a deliberate horizontal swipe", () => {
  assert.equal(productSwipeStep(-80, 12), 1);
  assert.equal(productSwipeStep(80, -12), -1);
  assert.equal(productSwipeStep(47, 0), 0);
  assert.equal(productSwipeStep(60, 60), 0);
  assert.equal(productSwipeStep(-90, 180), 0);
  assert.equal(productSwipeStep(0, 0), 0);
});
