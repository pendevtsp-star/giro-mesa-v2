import { describe, expect, it } from "vitest";
import { parsePaymentAttempt, parsePaymentCapabilities } from "./pos-payments";

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
