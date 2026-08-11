import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  InventoryConsumptionError,
  milliToQuantity,
  parseOrderSentPayload,
  quantityToMilli,
  recipeConsumptionMilli,
  recipeConsumptionQuantity,
} from "./inventory.js";

const payload = {
  orderId: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  tabId: "33333333-3333-4333-8333-333333333333",
  ticketIds: ["44444444-4444-4444-8444-444444444444"],
  unitId: "55555555-5555-4555-8555-555555555555",
};

describe("order inventory consumption rules", () => {
  it("accepts only the real strict order.sent payload", () => {
    assert.deepEqual(parseOrderSentPayload(payload), payload);
    assert.throws(
      () => parseOrderSentPayload({ ...payload, inventoryItemId: payload.orderId }),
      (error: unknown) =>
        error instanceof InventoryConsumptionError &&
        error.message === "INVENTORY_ORDER_EVENT_INVALID",
    );
  });

  it("uses integer milli-units and rounds yield loss upward", () => {
    assert.equal(recipeConsumptionMilli(250, 2, 1_000), 556n);
    assert.equal(milliToQuantity(556n), "0.556");
    assert.equal(quantityToMilli("-12.345"), -12_345n);
    assert.equal(milliToQuantity(quantityToMilli("10")), "10.000");
  });

  it("rejects a recipe with one hundred percent loss", () => {
    assert.throws(
      () => recipeConsumptionMilli(250, 2, 10_000),
      (error: unknown) =>
        error instanceof InventoryConsumptionError &&
        error.message === "INVENTORY_RECIPE_LOSS_INVALID",
    );
  });

  it("keeps six-decimal dimensional precision for versioned technical sheets", () => {
    assert.deepEqual(recipeConsumptionQuantity("0.333333", "l", 3, 9_000), {
      quantity: "1.111110",
      unit: "l",
      dimension: "volume",
    });
  });
});
