import { describe, expect, it } from "vitest";
import { purchaseReceiptLineState } from "./PurchasesPage";

describe("conferência de recebimento", () => {
  it("distingue recebimento completo, parcial e quantidade excedente", () => {
    expect(purchaseReceiptLineState("10", "4", "6")).toEqual({
      entered: 6,
      remaining: 6,
      pendingAfter: 0,
      exceedsRemaining: false,
    });
    expect(purchaseReceiptLineState("10", "4", "2,5")).toEqual({
      entered: 2.5,
      remaining: 6,
      pendingAfter: 3.5,
      exceedsRemaining: false,
    });
    expect(purchaseReceiptLineState("10", "4", "7")).toMatchObject({
      pendingAfter: 0,
      exceedsRemaining: true,
    });
  });

  it("não cria restante negativo para linha já concluída", () => {
    expect(purchaseReceiptLineState("5", "5", "0")).toEqual({
      entered: 0,
      remaining: 0,
      pendingAfter: 0,
      exceedsRemaining: false,
    });
  });
});
