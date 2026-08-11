import { createHash } from "node:crypto";
import type { FiscalAdapter, FiscalAdapterRequest, FiscalAdapterResult } from "@giromesa/domain";

export type FiscalSimulatorScenario = "authorized" | "rejected" | "pending_then_authorized";

export class FiscalSimulatorAdapter implements FiscalAdapter {
  readonly name = "fiscal-simulator";
  readonly homologated = false;
  private readonly scenarios = new Map<string, FiscalSimulatorScenario>();
  private readonly issues = new Map<string, FiscalAdapterResult>();
  private readonly lookups = new Map<string, FiscalAdapterResult>();

  constructor(private readonly defaultScenario: FiscalSimulatorScenario = "authorized") {}

  setScenario(idempotencyKey: string, scenario: FiscalSimulatorScenario) {
    this.scenarios.set(idempotencyKey, scenario);
  }

  async issue(request: FiscalAdapterRequest): Promise<FiscalAdapterResult> {
    const replay = this.issues.get(request.idempotencyKey);
    if (replay) return replay;
    const reference = `fiscal-sim-${createHash("sha256")
      .update(request.idempotencyKey)
      .digest("hex")
      .slice(0, 20)}`;
    const scenario = this.scenarios.get(request.idempotencyKey) ?? this.defaultScenario;
    const result: FiscalAdapterResult =
      scenario === "rejected"
        ? { status: "rejected", errorCode: "SIMULATED_FISCAL_REJECTION" }
        : scenario === "pending_then_authorized"
          ? { status: "pending", documentReference: reference }
          : { status: "authorized", documentReference: reference };
    this.issues.set(request.idempotencyKey, result);
    this.lookups.set(reference, { status: "authorized", documentReference: reference });
    return result;
  }

  async lookup(documentReference: string): Promise<FiscalAdapterResult> {
    return (
      this.lookups.get(documentReference) ?? {
        status: "pending",
        documentReference,
        errorCode: "SIMULATED_FISCAL_REFERENCE_NOT_FOUND",
      }
    );
  }

  async cancel(documentReference: string, reason: string): Promise<FiscalAdapterResult> {
    if (reason.trim().length < 15)
      return { status: "rejected", errorCode: "CANCEL_REASON_REQUIRED" };
    return { status: "cancelled", documentReference };
  }
}
