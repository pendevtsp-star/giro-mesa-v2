import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumePendingShellPaymentPairing,
  getShellPaymentCapabilities,
  redeemShellPaymentPairing,
  startShellPayment,
} from "./pos-payment-bridge";
import type { PaymentAction, PaymentAttempt } from "./pos-payments";

afterEach(() => vi.unstubAllGlobals());

describe("bridge financeiro SmartPOS", () => {
  it("entrega somente o identificador da tentativa ao shell nativo", async () => {
    const invoke = vi.fn().mockResolvedValue({
      Success: true,
      Launched: true,
      Status: "processing",
      AttemptId: "attempt-1",
      ProviderReference: null,
      ErrorCode: null,
      RequiresReconciliation: false,
    });
    vi.stubGlobal("window", { HybridWebView: { InvokeDotNet: invoke } });

    await startShellPayment(
      {
        id: "attempt-1",
        tabId: "tab-1",
        installationId: "installation-1",
        provider: "rede",
        method: "credit_card",
        amountCents: 19_990,
        installments: 3,
        status: "created",
        providerReference: null,
        failureCode: null,
        failureMessage: null,
        expiresAt: "2026-08-21T15:10:00.000Z",
        processingAt: null,
        resolvedAt: null,
        createdAt: "2026-08-21T15:00:00.000Z",
        updatedAt: "2026-08-21T15:00:00.000Z",
      } satisfies PaymentAttempt,
      { type: "start", attemptId: "attempt-1", provider: "rede" } satisfies PaymentAction,
    );

    expect(invoke).toHaveBeenCalledWith("StartPaymentAsync", ["attempt-1"]);
    expect(JSON.stringify(invoke.mock.calls)).not.toContain("19990");
    expect(JSON.stringify(invoke.mock.calls)).not.toContain("credit_card");
  });

  it("mantém a cobrança bloqueada quando o shell não confirma CanStart", async () => {
    const invoke = vi.fn().mockResolvedValue({
      Available: true,
      Configured: true,
      Homologated: true,
      Provider: "rede",
      Environment: "production",
      Methods: ["credit_card", "pix"],
      CanStart: false,
      ErrorCode: "SMARTPOS_TRUSTED_ATTEMPT_RESOLVER_UNAVAILABLE",
    });
    vi.stubGlobal("window", { HybridWebView: { InvokeDotNet: invoke } });

    await expect(getShellPaymentCapabilities()).resolves.toMatchObject({
      available: true,
      homologated: true,
      provider: "rede",
      methods: ["credit_card", "pix"],
      canStart: false,
      errorCode: "SMARTPOS_TRUSTED_ATTEMPT_RESOLVER_UNAVAILABLE",
    });
  });

  it("consome o deep link e delega o redeem P-256 ao aplicativo nativo", async () => {
    const invoke = vi.fn(async (method: string) =>
      method === "ConsumePendingPaymentPairingAsync"
        ? {
            Available: true,
            ApiBaseUrl: "https://api.giromesa.example",
            Code: "AB12CD34",
            ErrorCode: null,
          }
        : {
            Success: true,
            InstallationId: "00000000-0000-4000-8000-000000000111",
            Provider: "stone",
            Available: false,
            ErrorCode: null,
          },
    );
    vi.stubGlobal("window", { HybridWebView: { InvokeDotNet: invoke } });

    await expect(consumePendingShellPaymentPairing()).resolves.toMatchObject({
      available: true,
      code: "AB12CD34",
    });
    await redeemShellPaymentPairing("https://api.giromesa.example", "AB12CD34");

    expect(invoke).toHaveBeenLastCalledWith("RedeemPaymentPairingAsync", [
      "https://api.giromesa.example",
      "AB12CD34",
    ]);
  });
});
