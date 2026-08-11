import { createHash } from "node:crypto";
import {
  assertSafePaymentPayload,
  type PaymentAdapterRequest,
  type PaymentAdapterResult,
  type PaymentProviderAdapter,
} from "@giromesa/domain";

export type SimulatorScenario = "authorized" | "declined" | "unknown_then_authorized";

export class SimulatorPaymentAdapter implements PaymentProviderAdapter {
  readonly name = "api-simulator";
  private readonly scenarios = new Map<string, SimulatorScenario>();
  private readonly executions = new Map<string, PaymentAdapterResult>();
  private readonly lookupResults = new Map<string, PaymentAdapterResult>();

  setScenario(idempotencyKey: string, scenario: SimulatorScenario) {
    this.scenarios.set(idempotencyKey, scenario);
  }

  async execute(request: PaymentAdapterRequest): Promise<PaymentAdapterResult> {
    assertSafePaymentPayload(request);
    const replay = this.executions.get(request.idempotencyKey);
    if (replay) return replay;
    const reference = `sim-${createHash("sha256")
      .update(request.idempotencyKey)
      .digest("hex")
      .slice(0, 24)}`;
    const scenario = this.scenarios.get(request.idempotencyKey) ?? "authorized";
    const result: PaymentAdapterResult =
      scenario === "declined"
        ? {
            status: "declined",
            amountCents: request.amountCents,
            providerReference: reference,
            errorCode: "SIMULATED_DECLINE",
          }
        : scenario === "unknown_then_authorized"
          ? {
              status: "unknown",
              amountCents: request.amountCents,
              providerReference: reference,
              errorCode: "SIMULATED_TIMEOUT_AFTER_SEND",
            }
          : {
              status: "authorized",
              amountCents: request.amountCents,
              providerReference: reference,
            };
    const lookupResult: PaymentAdapterResult =
      scenario === "unknown_then_authorized"
        ? {
            status: "authorized",
            amountCents: request.amountCents,
            providerReference: reference,
          }
        : result;
    this.executions.set(request.idempotencyKey, result);
    this.lookupResults.set(reference, lookupResult);
    return result;
  }

  async lookup(providerReference: string): Promise<PaymentAdapterResult> {
    return (
      this.lookupResults.get(providerReference) ?? {
        status: "unknown",
        providerReference,
        errorCode: "SIMULATED_REFERENCE_NOT_FOUND",
      }
    );
  }
}
