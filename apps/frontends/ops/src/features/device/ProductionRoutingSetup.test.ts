import { describe, expect, it } from "vitest";
import type { CatalogProduct } from "../../operations.shared";
import { productConfigForStation, shouldApplyCategoryDestination } from "./ProductionRoutingSetup";

describe("productConfigForStation", () => {
  it("changes only production routing and preserves the unit configuration", () => {
    const product = {
      priceCents: 2_890,
      deliveryPriceCents: 3_190,
      costCents: 1_100,
      available: true,
      availabilitySchedule: null,
      dailyStockLimit: 20,
      autoDeductStock: true,
    } as CatalogProduct;

    expect(productConfigForStation(product, "station-bar")).toEqual({
      priceCents: 2_890,
      deliveryPriceCents: 3_190,
      costCents: 1_100,
      available: true,
      stationIds: ["station-bar"],
      stationRouting: [{ stationId: "station-bar", stage: 1 }],
      availabilitySchedule: null,
      dailyStock: 20,
      autoDeductStock: true,
    });
  });

  it("preserves products that intentionally pass through multiple areas", () => {
    expect(
      shouldApplyCategoryDestination(
        { stationIds: ["station-bar", "station-kitchen"] } as CatalogProduct,
        "station-bar",
      ),
    ).toBe(false);
    expect(
      shouldApplyCategoryDestination(
        { stationIds: ["station-old"] } as CatalogProduct,
        "station-bar",
      ),
    ).toBe(true);
  });
});
