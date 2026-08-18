import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bulkPriceSchema,
  importCatalogSchema,
  productSchema,
  promotionSchema,
} from "./pilot-schemas.js";

const categoryId = "11111111-1111-4111-8111-111111111111";
const stationId = "22222222-2222-4222-8222-222222222222";

const product = {
  categoryId,
  name: "Executivo",
  stationIds: [stationId],
  priceCents: 3_500,
  available: true,
  availabilitySchedule: null,
  allergenIds: [],
  modifierGroupIds: [],
  recipe: [],
};

describe("advanced catalog boundaries", () => {
  it("accepts a nullable schedule and rejects embedded image data", () => {
    assert.equal(productSchema.safeParse(product).success, true);
    assert.equal(
      productSchema.safeParse({ ...product, imageUrl: "data:image/png;base64,AA==" }).success,
      false,
    );
  });

  it("treats percentages as basis points and accepts recurring overnight windows", () => {
    const base = {
      name: "Happy hour",
      discountType: "percentage" as const,
      productIds: [categoryId],
      comboIds: [],
      categoryIds: [],
      channels: ["salon" as const],
      daysOfWeek: [5],
      startTime: "22:00",
      endTime: "02:00",
    };
    assert.equal(promotionSchema.safeParse({ ...base, discountValue: 2_000 }).success, true);
    assert.equal(promotionSchema.safeParse({ ...base, discountValue: 10_001 }).success, false);
  });

  it("supports both-channel bulk pricing and category-name imports", () => {
    assert.equal(
      bulkPriceSchema.safeParse({
        productIds: [categoryId],
        categoryIds: [],
        mode: "percentage",
        value: 500,
        channel: "both",
        reason: "Reajuste anual",
      }).success,
      true,
    );
    assert.equal(
      importCatalogSchema.safeParse({
        rows: [{ ...product, categoryId: undefined, categoryName: "Executivos" }],
        dryRun: true,
      }).success,
      true,
    );
  });
});
