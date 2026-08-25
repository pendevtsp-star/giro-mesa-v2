import { describe, expect, it } from "vitest";
import type { ProductionPrinter } from "../../api";
import {
  createProductionPrinterDraft,
  productionPrinterDefaultIsLocked,
  productionPrinterInput,
} from "./ProductionPrinterForm";

describe("production printer form contract", () => {
  it("preselects the Edge only when there is exactly one eligible hub", () => {
    expect(
      createProductionPrinterDraft(undefined, [
        { id: "hub-1", label: "Edge principal", lastSeenAt: null, online: true },
      ]).hubId,
    ).toBe("hub-1");
    expect(
      createProductionPrinterDraft(undefined, [
        { id: "hub-1", label: "Edge 1", lastSeenAt: null, online: true },
        { id: "hub-2", label: "Edge 2", lastSeenAt: null, online: false },
      ]).hubId,
    ).toBe("");
  });

  it("makes the first active printer the default of its Edge", () => {
    const hub = { id: "hub-1", label: "Edge principal", lastSeenAt: null, online: true };
    expect(createProductionPrinterDraft(undefined, [hub], []).isDefault).toBe(true);
    expect(
      createProductionPrinterDraft(
        undefined,
        [hub],
        [{ id: "printer-1", hubId: hub.id, active: true } as ProductionPrinter],
      ).isDefault,
    ).toBe(false);
  });

  it("locks removal of the only default printer of an Edge", () => {
    const current = {
      id: "printer-1",
      hubId: "hub-1",
      active: true,
      isDefault: true,
    } as ProductionPrinter;
    const draft = createProductionPrinterDraft(current);

    expect(productionPrinterDefaultIsLocked(draft, [current])).toBe(true);
    expect(
      productionPrinterDefaultIsLocked(draft, [
        current,
        {
          id: "printer-2",
          hubId: "hub-1",
          active: true,
          isDefault: true,
        } as ProductionPrinter,
      ]),
    ).toBe(false);
  });

  it("builds the writable contract without duplicating station assignments", () => {
    const input = productionPrinterInput({
      ...createProductionPrinterDraft(),
      hubId: "hub-1",
      label: " Cozinha ",
      host: " 192.168.1.50 ",
      documentTypes: ["kds_ticket", "kds_ticket"],
    });
    expect(input).toEqual(
      expect.objectContaining({
        hubId: "hub-1",
        label: "Cozinha",
        host: "192.168.1.50",
        documentTypes: ["kds_ticket"],
      }),
    );
    expect(input).not.toHaveProperty("stationIds");
  });
});
