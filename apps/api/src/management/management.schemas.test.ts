import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recipeConfigurationSchema } from "./management.schemas.js";

const recipe = {
  productId: "11111111-1111-4111-8111-111111111111",
  yieldQuantity: "12",
  components: [
    {
      inventoryItemId: "22222222-2222-4222-8222-222222222222",
      locationId: "33333333-3333-4333-8333-333333333333",
      quantity: "1.000000",
      unit: "kg",
    },
  ],
};

describe("management schemas", () => {
  it("accepts only count units for a recipe batch yield", () => {
    assert.equal(recipeConfigurationSchema.safeParse({ ...recipe, yieldUnit: "unit" }).success, true);
    assert.equal(recipeConfigurationSchema.safeParse({ ...recipe, yieldUnit: "dozen" }).success, true);
    assert.equal(recipeConfigurationSchema.safeParse({ ...recipe, yieldUnit: "kg" }).success, false);
    assert.equal(recipeConfigurationSchema.safeParse({ ...recipe, yieldUnit: "ml" }).success, false);
  });
});
