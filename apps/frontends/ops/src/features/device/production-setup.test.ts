import { describe, expect, it } from "vitest";
import type { ProductionPrinter } from "../../api";
import { firstIncompleteProductionStep, productionSetupReadiness } from "./production-setup";

describe("production setup readiness", () => {
  it("keeps the flow on the first real incomplete step", () => {
    const hub = { online: true };
    const printer: Pick<ProductionPrinter, "active" | "documentTypes" | "lastStatus"> = {
      active: true,
      documentTypes: ["kds_ticket"],
      lastStatus: "online",
    };
    const station = { active: true, readiness: { ready: true } };

    const readiness = productionSetupReadiness([hub], [printer], [station], false);

    expect(firstIncompleteProductionStep(readiness)).toBe("routing");
    expect(readiness.check).toBe(false);
  });

  it("does not treat a disconnected computer or failed printer as ready", () => {
    const readiness = productionSetupReadiness(
      [{ online: false }],
      [
        {
          active: true,
          documentTypes: ["kds_ticket"],
          lastStatus: "error",
        },
      ],
      [],
      true,
    );

    expect(readiness.computer).toBe(false);
    expect(readiness.printer).toBe(false);
    expect(firstIncompleteProductionStep(readiness)).toBe("computer");
  });
});
