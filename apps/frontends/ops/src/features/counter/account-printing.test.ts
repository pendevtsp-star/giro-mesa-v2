import { describe, expect, it } from "vitest";
import type { PosPrintJob } from "../../api";
import type { PosItem, PosTab } from "../../operations.shared";
import { statementMatchesCurrentAccount } from "./account-printing";
import { splitConsumptionPreview } from "./SplitConsumptionPanel";

const brownie: PosItem = {
  id: "brownie",
  orderId: "order",
  orderStatus: "sent",
  productName: "Brownie",
  quantity: 2,
  grossCents: 2800,
  discountCents: 0,
  netCents: 2800,
  status: "sent",
  seatNumber: null,
  course: "dessert",
  allergyNote: null,
  notes: null,
};
const tab = { id: "tab-1", totalCents: 2800 } as PosTab;
const statement = {
  payload: {
    context: { tabId: tab.id },
    totals: { totalCents: 2800, paidCents: 0 },
    items: [brownie],
  },
} as unknown as PosPrintJob;

describe("pré-conta atual e separação de consumo", () => {
  it("reconhece somente o snapshot da conta atual, com quantidades, valores e pagamentos atuais", () => {
    expect(statementMatchesCurrentAccount(statement, tab, [brownie], 0)).toBe(true);
    expect(
      statementMatchesCurrentAccount(statement, { ...tab, id: "outra-conta" }, [brownie], 0),
    ).toBe(false);
    expect(
      statementMatchesCurrentAccount(statement, { ...tab, totalCents: 3000 }, [brownie], 0),
    ).toBe(false);
    expect(statementMatchesCurrentAccount(statement, tab, [{ ...brownie, quantity: 1 }], 0)).toBe(
      false,
    );
    expect(
      statementMatchesCurrentAccount(statement, tab, [{ ...brownie, netCents: 2700 }], 0),
    ).toBe(false);
    expect(statementMatchesCurrentAccount(statement, tab, [brownie], 1000)).toBe(false);
    expect(statementMatchesCurrentAccount(statement, { ...tab, label: "Ana" }, [brownie], 0)).toBe(
      false,
    );
    expect(statementMatchesCurrentAccount(statement, { ...tab, tipCents: 100 }, [brownie], 0)).toBe(
      false,
    );
    expect(
      statementMatchesCurrentAccount(statement, tab, [{ ...brownie, status: "canceled" }], 0),
    ).toBe(false);
  });

  it("separa um de dois brownies e conserva o saldo dos dois documentos", () => {
    expect(splitConsumptionPreview([brownie], { brownie: 1 })).toEqual({
      valid: true,
      quantity: 1,
      movedCents: 1400,
      remainingCents: 1400,
    });
    expect(splitConsumptionPreview([brownie], {})).toEqual({
      valid: true,
      quantity: 0,
      movedCents: 0,
      remainingCents: 2800,
    });
  });

  it("arredonda bruto e desconto separadamente e mantém cada centavo", () => {
    const discounted = {
      ...brownie,
      quantity: 3,
      grossCents: 1000,
      discountCents: 101,
      netCents: 899,
    };
    const first = splitConsumptionPreview([discounted], { brownie: 1 });
    expect(first).toEqual({ valid: true, quantity: 1, movedCents: 300, remainingCents: 599 });
    for (const quantity of [0, 1, 2, 3]) {
      const result = splitConsumptionPreview([discounted], { brownie: quantity });
      expect(result.movedCents + result.remainingCents).toBe(discounted.netCents);
    }
  });

  it.each([
    -1,
    0.5,
    3,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("recusa quantidade inválida %s", (quantity) => {
    expect(splitConsumptionPreview([brownie], { brownie: quantity }).valid).toBe(false);
  });
});
