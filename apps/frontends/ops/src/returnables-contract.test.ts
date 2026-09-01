import { describe, expect, it } from "vitest";
import { parseReturnables } from "./management.shared";

describe("contrato de configuração de retornáveis", () => {
  it("preserva todos os vínculos ativos do produto", () => {
    const parsed = parseReturnables({
      configurations: [
        {
          id: "mapping-bottle",
          productId: "beer",
          containerInventoryItemId: "bottle",
          quantityPerUnit: "12.000",
          depositCents: 100,
          active: true,
        },
        {
          id: "mapping-crate",
          productId: "beer",
          containerInventoryItemId: "crate",
          quantityPerUnit: "1.000",
          depositCents: 500,
          active: true,
        },
      ],
    });

    expect(parsed.configurations).toEqual([
      expect.objectContaining({
        productId: "beer",
        containerInventoryItemId: "bottle",
        quantityPerUnit: 12,
        depositCents: 100,
        active: true,
      }),
      expect.objectContaining({
        productId: "beer",
        containerInventoryItemId: "crate",
        quantityPerUnit: 1,
        depositCents: 500,
        active: true,
      }),
    ]);
  });
});
