import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  paymentAttemptCreateSchema,
  paymentDeviceResultSchema,
  paymentReconciliationInputSchema,
  paymentTerminalConfigurationSchema,
} from "./index.js";

describe("SmartPOS contracts", () => {
  it("accepts only valid integrated payment requests", () => {
    const installationId = "00000000-0000-4000-8000-000000000001";
    assert.equal(
      paymentAttemptCreateSchema.safeParse({
        method: "credit_card",
        amountCents: 1_500,
        installments: 3,
        installationId,
      }).success,
      true,
    );
    assert.equal(
      paymentAttemptCreateSchema.safeParse({
        method: "pix",
        amountCents: 1_500,
        installments: 2,
        installationId,
      }).success,
      false,
    );
  });

  it("requires a provider reference and rejects card data on approval", () => {
    const base = {
      resultId: "provider-result-0001",
      status: "approved" as const,
      occurredAt: "2026-08-21T12:00:00.000-03:00",
    };
    assert.equal(paymentDeviceResultSchema.safeParse(base).success, false);
    assert.equal(
      paymentDeviceResultSchema.safeParse({ ...base, providerReference: "rede-123" }).success,
      true,
    );
    assert.equal(
      paymentDeviceResultSchema.safeParse({
        ...base,
        providerReference: "rede-123",
        pan: "4111111111111111",
      }).success,
      false,
    );
    assert.equal(
      paymentDeviceResultSchema.safeParse({
        ...base,
        providerReference: "rede-123",
        failureMessage: "Cartão 4111111111111111 recusado",
      }).success,
      false,
    );
    for (const input of [
      { ...base, resultId: "4111111111111111", providerReference: "rede-123" },
      { ...base, providerReference: "4111-1111-1111-1111" },
      {
        ...base,
        providerReference: "rede-123",
        authorizationCode: "4111 1111 1111 1111",
      },
      {
        ...base,
        status: "declined" as const,
        failureCode: "4111111111111111",
      },
    ]) {
      assert.equal(paymentDeviceResultSchema.safeParse(input).success, false);
    }
    for (const input of [
      { ...base, resultId: "resultado inválido", providerReference: "rede-123" },
      { ...base, providerReference: "referência livre" },
      { ...base, providerReference: "rede-123", authorizationCode: "AÇÃO 123" },
      { ...base, status: "declined" as const, failureCode: "declined by bank" },
    ]) {
      assert.equal(paymentDeviceResultSchema.safeParse(input).success, false);
    }
  });

  it("rejects card data in provider reconciliation identifiers", () => {
    const base = {
      provider: "rede" as const,
      providerSettlementId: "settlement-001",
      providerReference: "rede-123",
      grossCents: 1_000,
      feeCents: 20,
      netCents: 980,
      expectedSettlementAt: "2026-08-22T12:00:00.000-03:00",
      settledAt: null,
      status: "pending" as const,
      source: "webhook" as const,
    };
    assert.equal(paymentReconciliationInputSchema.safeParse(base).success, true);
    assert.equal(
      paymentReconciliationInputSchema.safeParse({
        ...base,
        providerSettlementId: "4111-1111-1111-1111",
      }).success,
      false,
    );
    assert.equal(
      paymentReconciliationInputSchema.safeParse({
        ...base,
        providerReference: "4111 1111 1111 1111",
      }).success,
      false,
    );
    assert.equal(
      paymentReconciliationInputSchema.safeParse({
        ...base,
        providerSettlementId: "lote com espaço",
      }).success,
      false,
    );
    assert.equal(
      paymentReconciliationInputSchema.safeParse({
        ...base,
        providerReference: "referência-livre",
      }).success,
      false,
    );
  });

  it("requires an internal certification before integrated capabilities are enabled", () => {
    const configuration = {
      provider: "rede" as const,
      status: "homologated" as const,
      certificationId: "00000000-0000-4000-8000-000000000002",
      methods: ["credit_card" as const],
      maxInstallments: 12,
      supports: { cancel: true, recover: true, reversal: true },
    };
    assert.equal(paymentTerminalConfigurationSchema.safeParse(configuration).success, true);
    assert.equal(
      paymentTerminalConfigurationSchema.safeParse({
        ...configuration,
        certificationId: undefined,
      }).success,
      false,
    );
  });
});
