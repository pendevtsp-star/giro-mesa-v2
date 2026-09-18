import assert from "node:assert/strict";
import { it } from "node:test";
import { readOrderPriceChange } from "./order-price-change.ts";

it("accepts only a complete, consistent server price conflict", () => {
  const payload = {
    code: "PUBLIC_ORDER_PRICE_CHANGED",
    subtotalCents: 4_000,
    deliveryFeeCents: 700,
    totalCents: 4_700,
  };
  assert.deepEqual(readOrderPriceChange(payload), {
    subtotalCents: 4_000,
    deliveryFeeCents: 700,
    totalCents: 4_700,
  });
  for (const invalid of [
    null,
    {},
    { ...payload, code: "IDEMPOTENCY_KEY_REUSED" },
    { ...payload, totalCents: 4_000 },
    { ...payload, deliveryFeeCents: -1 },
    { ...payload, totalCents: "4700" },
  ])
    assert.equal(readOrderPriceChange(invalid), null);
});
