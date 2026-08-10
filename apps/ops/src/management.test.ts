import { describe, expect, it } from "vitest";
import {
  InvalidManagementPayloadError,
  parseCash,
  parseInventory,
  parseRecipeCatalog,
  parseRecipes,
  recipeLossToBasisPoints,
  recipeQuantityToMilli,
} from "./management";

describe("dados gerenciais reais", () => {
  it("preserva estado vazio retornado pela API sem inserir fixtures", () => {
    expect(parseInventory({ locations: [], items: [], balances: [] })).toEqual({
      locations: [],
      items: [],
      balances: [],
    });
    expect(parseCash({ shifts: [], movements: [] })).toEqual({ shifts: [], movements: [] });
  });

  it("recusa payload inválido em vez de cair silenciosamente no modo demo", () => {
    expect(() => parseInventory({ locations: [], items: "indisponível", balances: [] })).toThrow(
      InvalidManagementPayloadError,
    );
  });

  it("interpreta produtos e a versão ativa com componentes reais", () => {
    expect(
      parseRecipeCatalog({
        products: [{ id: "product-1", name: "Burger da casa", active: true }],
      }),
    ).toEqual({
      products: [{ id: "product-1", name: "Burger da casa", active: true }],
    });
    expect(
      parseRecipes([
        {
          id: "recipe-1",
          productId: "product-1",
          version: 3,
          validFrom: "2026-08-10T15:00:00.000Z",
          validUntil: null,
          components: [
            {
              inventoryItemId: "item-1",
              locationId: "location-1",
              quantityMilli: 180,
              lossBasisPoints: 250,
            },
          ],
        },
      ]),
    ).toEqual([
      {
        id: "recipe-1",
        productId: "product-1",
        version: 3,
        validFrom: "2026-08-10T15:00:00.000Z",
        validUntil: null,
        components: [
          {
            inventoryItemId: "item-1",
            locationId: "location-1",
            quantityMilli: 180,
            lossBasisPoints: 250,
          },
        ],
      },
    ]);
  });

  it("converte quantidade e perda sem arredondamento operacional silencioso", () => {
    expect(recipeQuantityToMilli("1,250")).toBe(1_250);
    expect(recipeQuantityToMilli("0.001")).toBe(1);
    expect(recipeLossToBasisPoints("2,50")).toBe(250);
    expect(recipeLossToBasisPoints("0")).toBe(0);
    expect(() => recipeQuantityToMilli("0")).toThrow(/maior que zero/i);
    expect(() => recipeQuantityToMilli("0,0001")).toThrow(/três casas/i);
    expect(() => recipeLossToBasisPoints("100")).toThrow(/99,99%/i);
    expect(() => recipeLossToBasisPoints("2,505")).toThrow(/duas casas/i);
  });
});
