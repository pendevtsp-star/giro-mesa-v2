import assert from "node:assert/strict";
import { it } from "node:test";
import { requireConfirmedPublicTotal } from "./public-order-total.js";

it("requires explicit confirmation of the server total, including discounts and delivery fees", () => {
  for (const expected of [undefined, 0, 5_000, 6_800]) {
    assert.throws(
      () => requireConfirmedPublicTotal(expected, 6_000, 700),
      (error: unknown) => {
        const exception = error as { getStatus(): number; getResponse(): unknown };
        assert.equal(exception.getStatus(), 409);
        assert.deepEqual(exception.getResponse(), {
          code: "PUBLIC_ORDER_PRICE_CHANGED",
          message: "Os valores foram atualizados. Confira e confirme o novo total antes de enviar.",
          subtotalCents: 6_000,
          deliveryFeeCents: 700,
          totalCents: 6_700,
        });
        return true;
      },
    );
  }
  assert.doesNotThrow(() => requireConfirmedPublicTotal(6_700, 6_000, 700));
  assert.doesNotThrow(() => requireConfirmedPublicTotal(0, 0));
});
