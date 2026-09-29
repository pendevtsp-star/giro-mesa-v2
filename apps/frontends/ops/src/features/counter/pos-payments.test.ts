import { describe, expect, it } from "vitest";
import {
  getPosPaymentAccess,
  parseManualPaymentReversal,
  parsePaymentAttempt,
  parsePaymentCapabilities,
  paymentAttemptContextError,
  paymentBlockReason,
} from "./pos-payments";

const attempt = {
  id: "attempt-1",
  tabId: "tab-1",
  installationId: "installation-1",
  provider: "rede",
  method: "debit_card",
  amountCents: 12_490,
  installments: 1,
  status: "processing",
  providerReference: null,
  failureCode: null,
  failureMessage: null,
  expiresAt: "2026-08-21T15:10:00.000Z",
  processingAt: "2026-08-21T15:00:01.000Z",
  resolvedAt: null,
  createdAt: "2026-08-21T15:00:00.000Z",
  updatedAt: "2026-08-21T15:00:01.000Z",
};

describe("contratos defensivos do pagamento SmartPOS", () => {
  it("combina o papel operacional com o modo do terminal sem liberar recebimento manual ao garçom", () => {
    const expectedAccess = [
      ["owner", true, true],
      ["manager", true, true],
      ["cashier", true, true],
      ["waiter", false, true],
      ["finance", false, false],
      ["delivery", false, false],
      ["unknown", false, false],
    ] as const;
    for (const [profile, manualAllowed, integratedAllowed] of expectedAccess) {
      for (const mode of ["disabled", "cashier", "homologated_pos"] as const) {
        expect(getPosPaymentAccess(profile, mode)).toEqual({
          cashierPaymentEnabled: mode === "cashier" && manualAllowed,
          integratedPaymentEnabled: mode === "homologated_pos" && integratedAllowed,
        });
      }
    }
  });
  it("confirma correção manual apenas para pagamento correspondente aprovado sem ação externa", () => {
    const reversal = {
      id: "reversal-1",
      paymentId: "payment-1",
      status: "approved",
      amountCents: 1500,
    };
    expect(parseManualPaymentReversal({ reversal, action: null }, "payment-1")).toEqual({
      reversal,
      action: null,
    });
    for (const status of ["pending", "processing", "declined", "unknown"]) {
      expect(() =>
        parseManualPaymentReversal(
          { reversal: { ...reversal, status }, action: null },
          "payment-1",
        ),
      ).toThrow();
    }
    expect(() => parseManualPaymentReversal({ reversal, action: null }, "other-payment")).toThrow();
    expect(() =>
      parseManualPaymentReversal({ reversal, action: { type: "reverse" } }, "payment-1"),
    ).toThrow();
    for (const amountCents of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        parseManualPaymentReversal(
          { reversal: { ...reversal, amountCents }, action: null },
          "payment-1",
        ),
      ).toThrow();
    }
  });
  it("aceita somente a comanda e a maquininha do deep link", () => {
    expect(paymentAttemptContextError(attempt, "tab-1", "installation-1")).toBeNull();
    expect(paymentAttemptContextError(attempt, "tab-2", "installation-1")).toContain(
      "outra comanda",
    );
    expect(paymentAttemptContextError(attempt, "tab-1", "installation-2")).toContain(
      "outra maquininha",
    );
  });
  it("explica bloqueios sem expor códigos técnicos e preserva motivos do responsável", () => {
    expect(paymentBlockReason("PAYMENT_DEVICE_NOT_ENROLLED")).toContain("código de ativação");
    expect(paymentBlockReason("PAYMENT_FUTURE_REASON")).not.toContain("PAYMENT_");
    expect(paymentBlockReason("Bloqueio preventivo do suporte")).toBe(
      "Bloqueio preventivo do suporte",
    );
    expect(paymentBlockReason(null)).toBeNull();
  });
  it("aceita capacidades homologadas sem abrir o formato para provedores desconhecidos", () => {
    expect(
      parsePaymentCapabilities({
        installationId: "installation-1",
        available: true,
        status: "homologated",
        provider: "rede",
        methods: ["credit_card", "debit_card", "pix", "cash"],
        maxInstallments: 48,
        supports: { cancel: true, recover: true, reversal: false },
        reason: null,
      }),
    ).toMatchObject({
      methods: ["credit_card", "debit_card", "pix"],
      maxInstallments: 24,
      provider: "rede",
    });

    expect(() =>
      parsePaymentCapabilities({
        installationId: "installation-1",
        available: true,
        status: "homologated",
        provider: "provider-arbitrario",
        methods: ["debit_card"],
        maxInstallments: 1,
        supports: {},
        reason: null,
      }),
    ).toThrow("Provedor de pagamento inválido");
  });

  it("rejeita valor, parcelamento e estado financeiro inválidos", () => {
    expect(parsePaymentAttempt(attempt)).toMatchObject({
      id: "attempt-1",
      amountCents: 12_490,
      status: "processing",
    });
    expect(() => parsePaymentAttempt({ ...attempt, amountCents: 0 })).toThrow("Valor inválido");
    expect(() => parsePaymentAttempt({ ...attempt, installments: 25 })).toThrow(
      "Parcelamento inválido",
    );
    expect(() => parsePaymentAttempt({ ...attempt, status: "paid" })).toThrow(
      "Estado da tentativa de pagamento inválido",
    );
  });
});
