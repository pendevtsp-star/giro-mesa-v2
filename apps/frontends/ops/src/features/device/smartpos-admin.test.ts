import { describe, expect, it } from "vitest";
import {
  parseSmartPosDevices,
  parseSmartPosHealth,
  parseSmartPosHomologationRuns,
  parseSmartPosPairing,
  parseSmartPosReconciliation,
} from "./smartpos-admin";

const diagnostics = {
  manufacturer: "Stone",
  model: "Sunmi P2",
  androidVersion: "11",
  firmwareVersion: "1.4.2",
  appVersion: "0.2.3",
  packageName: "com.giromesa.ops",
  signingCertificateSha256: "a".repeat(64),
};

const checklist = {
  debitApproved: true,
  creditApproved: true,
  installmentsApproved: true,
  pixApproved: true,
  declinedHandled: true,
  canceledHandled: true,
  networkRecoveryHandled: true,
  reversalApproved: false,
  receiptValidated: true,
};

describe("contratos gerenciais SmartPOS", () => {
  it("aceita pareamento temporário e rejeita payload incompleto", () => {
    expect(
      parseSmartPosPairing({
        pairingId: "pairing-1",
        code: "AB12CD34",
        qrPayload: "giromesa-pairing-payload",
        expiresAt: "2026-08-21T17:05:00.000Z",
      }),
    ).toMatchObject({ code: "AB12CD34", pairingId: "pairing-1" });
    expect(() => parseSmartPosPairing({ code: "AB12CD34" })).toThrow("pairingId");
  });

  it("mantém diagnóstico, certificação e kill switch vindos do servidor", () => {
    const devices = parseSmartPosDevices({
      devices: [
        {
          installationId: "00000000-0000-4000-8000-000000000111",
          label: "POS Balcão",
          enrolledAt: "2026-08-21T17:00:00.000Z",
          revokedAt: null,
          lastSeenAt: "2026-08-21T17:03:00.000Z",
          reportedDiagnostics: diagnostics,
          capabilities: {
            installationId: "00000000-0000-4000-8000-000000000111",
            available: false,
            status: "suspended",
            provider: "stone",
            methods: ["credit_card", "debit_card", "pix"],
            maxInstallments: 12,
            supports: { cancel: true, recover: true, reversal: false },
            reason: "CERTIFICATION_SUSPENDED",
            certificationId: "00000000-0000-4000-8000-000000000222",
            diagnosticsMatch: true,
            killSwitch: { enabled: true, reason: "Suporte bloqueou preventivamente" },
          },
          certification: {
            id: "00000000-0000-4000-8000-000000000222",
            provider: "stone",
            status: "suspended",
            killSwitchEnabled: true,
            killSwitchReason: "Suporte bloqueou preventivamente",
          },
        },
      ],
    });
    expect(devices[0]).toMatchObject({
      label: "POS Balcão",
      capabilities: { available: false, diagnosticsMatch: true, killSwitch: { enabled: true } },
    });
    expect(() =>
      parseSmartPosDevices({
        devices: [
          {
            ...devices[0],
            capabilities: { ...devices[0]?.capabilities, methods: ["cash"] },
          },
        ],
      }),
    ).toThrow("method");
  });

  it("lê saúde e conciliação sem transformar divergência em confirmação", () => {
    expect(
      parseSmartPosHealth({
        generatedAt: "2026-08-21T17:05:00.000Z",
        summary: {
          unknownAttempts: 1,
          staleProcessingAttempts: 2,
          offlineDevices: 1,
          reconciliationDivergences: 3,
        },
        incidents: [
          {
            kind: "unknown_attempt",
            severity: "critical",
            entityId: "attempt-1",
            label: "Cobrança da comanda 12",
            occurredAt: "2026-08-21T16:55:00.000Z",
          },
        ],
      }).summary,
    ).toMatchObject({ unknownAttempts: 1, reconciliationDivergences: 3 });

    expect(
      parseSmartPosReconciliation({
        entries: [
          {
            id: "reconciliation-1",
            paymentId: "payment-1",
            provider: "rede",
            providerSettlementId: "settlement-1",
            providerReference: "rede-1",
            grossCents: 10_000,
            feeCents: 200,
            netCents: 9_800,
            expectedSettlementAt: "2026-08-22T17:00:00.000Z",
            settledAt: null,
            status: "divergent",
            source: "webhook",
            createdAt: "2026-08-21T17:00:00.000Z",
            updatedAt: "2026-08-21T17:01:00.000Z",
          },
        ],
        summary: { grossCents: 10_000, feeCents: 200, netCents: 9_800, divergences: 1 },
      }).entries[0]?.status,
    ).toBe("divergent");
  });

  it("preserva checklist e resultado registrado de homologação", () => {
    const runs = parseSmartPosHomologationRuns({
      runs: [
        {
          id: "run-1",
          certificationId: "00000000-0000-4000-8000-000000000222",
          installationId: "00000000-0000-4000-8000-000000000111",
          terminalSerialHash: "b".repeat(64),
          environment: "homologation",
          checklist,
          evidenceReference: "ticket-123",
          notes: null,
          passed: false,
          recordedByIdentityId: "identity-1",
          createdAt: "2026-08-21T17:00:00.000Z",
        },
      ],
    });
    expect(runs[0]).toMatchObject({ passed: false, checklist: { reversalApproved: false } });
  });
});
