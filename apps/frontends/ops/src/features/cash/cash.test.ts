import { describe, expect, it } from "vitest";
import type { CashEntry } from "../../management.shared";
import { summarizeCashEntries } from "./cash";

function entry(values: Partial<CashEntry>): CashEntry {
  return {
    id: crypto.randomUUID(),
    cashShiftId: "shift-1",
    direction: "in",
    entryType: "pos_payment",
    paymentMethod: "cash",
    affectsDrawer: true,
    amountCents: 0,
    description: null,
    actorName: null,
    occurredAt: null,
    ...values,
  };
}

describe("resumo do turno de caixa", () => {
  it("separa o saldo físico da conciliação por método", () => {
    const summary = summarizeCashEntries([
      entry({ amountCents: 2_000 }),
      entry({ amountCents: 3_000, paymentMethod: "pix", affectsDrawer: false }),
      entry({
        amountCents: 1_000,
        direction: "out",
        entryType: "reversal",
        paymentMethod: "pix",
        affectsDrawer: false,
      }),
      entry({ amountCents: 500, direction: "out", entryType: "withdrawal", paymentMethod: null }),
    ]);

    expect(summary.drawerInCents).toBe(2_000);
    expect(summary.drawerOutCents).toBe(500);
    expect(Object.fromEntries(summary.byMethod)).toEqual({ cash: 2_000, pix: 2_000 });
  });
});
