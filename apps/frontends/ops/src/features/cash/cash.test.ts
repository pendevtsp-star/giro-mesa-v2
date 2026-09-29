import { describe, expect, it } from "vitest";
import type { CashEntry } from "../../management.shared";
import { cashHandoverCandidates, summarizeCashEntries, visibleCashAlerts } from "./cash";

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

describe("responsabilidade do caixa", () => {
  it("oferece somente operadores diferentes do responsável atual e de quem transfere", () => {
    const operators = ["actor", "responsible", "other"].map((identityId) => ({
      identityId,
      name: identityId,
    }));
    expect(cashHandoverCandidates(operators, "responsible", "actor")).toEqual([operators[2]]);
    expect(cashHandoverCandidates(operators, "actor", "actor")).toEqual(operators.slice(1));
    expect(cashHandoverCandidates(operators, null, "actor")).toEqual(operators.slice(1));
    expect(cashHandoverCandidates(operators, "responsible")).toEqual([operators[0], operators[2]]);
  });
});

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

describe("alertas do caixa", () => {
  it("mostra cada pendência no painel e mantém alertas críticos ou sem painel acessível", () => {
    const approval = {
      code: "CASH_APPROVAL_PENDING",
      severity: "warning",
      message: "Aprovação pendente",
      cashShiftId: "shift-a",
    };
    const transfer = {
      code: "CASH_TRANSFER_PENDING",
      severity: "warning",
      message: "Aceite pendente",
      cashShiftId: "shift-b",
    };
    const data: Parameters<typeof visibleCashAlerts>[0] = {
      capabilities: {
        canOpen: true,
        canClose: true,
        canMove: true,
        canReview: true,
        canViewExpected: true,
        canManageRegisters: true,
        canTransfer: true,
        canManageCashSettings: true,
        canManageTerminals: true,
        canApproveCashRequests: true,
        canHandover: true,
      },
      alerts: [
        approval,
        approval,
        transfer,
        { ...approval, severity: "critical" },
        { code: "CASH_SHIFT_TOO_LONG", severity: "warning", message: "Turno antigo" },
      ].map((alert) => ({
        ...alert,
        severity: alert.severity === "critical" ? "critical" : "warning",
        cashShiftId: "cashShiftId" in alert ? alert.cashShiftId : null,
        cashRegisterId: null,
        installationId: null,
      })),
      approvals: [
        {
          id: "approval",
          status: "pending",
          fromCashShiftId: "shift-a",
          reason: "QA",
          requestedByName: "QA",
          kind: "supply",
          amountCents: 100,
          toCashShiftId: null,
          requestedAt: null,
        },
      ],
      pendingTransfers: [
        {
          id: "transfer",
          fromCashShiftId: "shift-a",
          toCashShiftId: "shift-b",
          fromCashRegisterName: "A",
          toCashRegisterName: "B",
          reason: "QA",
          requestedByName: "QA",
          amountCents: 100,
          requestedAt: null,
          canDecide: true,
        },
      ],
    };
    expect(visibleCashAlerts(data).map((alert) => alert.message)).toEqual([
      "Aprovação pendente",
      "Turno antigo",
    ]);
    data.capabilities.canApproveCashRequests = false;
    expect(visibleCashAlerts(data).map((alert) => alert.severity)).toEqual([
      "warning",
      "critical",
      "warning",
    ]);
    data.approvals = [];
    data.pendingTransfers = [];
    expect(visibleCashAlerts(data)).toHaveLength(4);
  });
});
