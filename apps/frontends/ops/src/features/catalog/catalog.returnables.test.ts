import { describe, expect, it } from "vitest";
import {
  activeReturnableContainers,
  buildCatalogReturnablePayload,
  readCatalogReturnableDraft,
} from "./catalog.returnables";

describe("configuração retornável do produto", () => {
  it("lê todos os vínculos ativos persistidos", () => {
    expect(
      readCatalogReturnableDraft(
        "product-1",
        [
          {
            productId: "product-1",
            productName: "Refrigerante",
            containerInventoryItemId: "bottle-1",
            active: true,
            classification: "returnable",
          },
        ],
        [
          {
            id: "mapping-1",
            productId: "product-1",
            containerInventoryItemId: "bottle-1",
            quantityPerUnit: 1,
            depositCents: 250,
            active: true,
          },
          {
            id: "mapping-2",
            productId: "product-1",
            containerInventoryItemId: "crate-1",
            quantityPerUnit: 0.083,
            depositCents: 0,
            active: true,
          },
        ],
      ),
    ).toEqual({
      status: "returnable",
      mappings: [
        {
          key: "mapping-1",
          containerInventoryItemId: "bottle-1",
          quantityPerUnit: "1",
          deposit: "2,50",
        },
        {
          key: "mapping-2",
          containerInventoryItemId: "crate-1",
          quantityPerUnit: "0.083",
          deposit: "0,00",
        },
      ],
    });
  });

  it("impede embalagens duplicadas", () => {
    expect(
      buildCatalogReturnablePayload("returnable", [
        {
          key: "1",
          containerInventoryItemId: "bottle-1",
          quantityPerUnit: "1",
          deposit: "2,50",
        },
        {
          key: "2",
          containerInventoryItemId: "bottle-1",
          quantityPerUnit: "2",
          deposit: "0",
        },
      ]).error,
    ).toContain("mesma embalagem");
  });

  it("envia a configuração completa em centavos", () => {
    expect(
      buildCatalogReturnablePayload("returnable", [
        {
          key: "1",
          containerInventoryItemId: "bottle-1",
          quantityPerUnit: "1,2345",
          deposit: "2,75",
        },
      ]).payload,
    ).toEqual({
      status: "returnable",
      mappings: [
        { containerInventoryItemId: "bottle-1", quantityPerUnit: "1.235", depositCents: 275 },
      ],
    });
  });

  it("remove os vínculos quando o produto é não retornável", () => {
    expect(buildCatalogReturnablePayload("non_returnable", []).payload).toEqual({
      status: "non_returnable",
      mappings: [],
    });
  });

  it("oferece somente vasilhames ativos", () => {
    expect(
      activeReturnableContainers([
        { id: "bottle", active: true, kind: "returnable_container" },
        { id: "inactive", active: false, kind: "returnable_container" },
        { id: "ingredient", active: true, kind: "ingredient" },
      ]),
    ).toEqual([{ id: "bottle", active: true, kind: "returnable_container" }]);
  });
});
