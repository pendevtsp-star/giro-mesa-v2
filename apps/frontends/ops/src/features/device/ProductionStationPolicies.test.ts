import { describe, expect, it } from "vitest";
import type { ProductionPrinter, ProductionPrintingPolicy } from "../../api";
import { productionStationPolicyCanBeSaved } from "./ProductionStationPolicies";

const printer = {
  id: "printer-1",
  active: true,
  documentTypes: ["kds_ticket"],
} as ProductionPrinter;

describe("productionStationPolicyCanBeSaved", () => {
  it("aceita modos sem impressão sem atribuição física", () => {
    const policy: ProductionPrintingPolicy = {
      deliveryMode: "kds_only",
      copies: 1,
      printerId: null,
    };

    expect(productionStationPolicyCanBeSaved(policy, [])).toBe(true);
  });

  it("exige impressora ativa compatível com ticket KDS", () => {
    const policy: ProductionPrintingPolicy = {
      deliveryMode: "both",
      copies: 2,
      printerId: printer.id,
    };

    expect(productionStationPolicyCanBeSaved(policy, [printer])).toBe(true);
    expect(productionStationPolicyCanBeSaved(policy, [{ ...printer, active: false }])).toBe(false);
    expect(
      productionStationPolicyCanBeSaved(policy, [{ ...printer, documentTypes: ["final_receipt"] }]),
    ).toBe(false);
  });
});
