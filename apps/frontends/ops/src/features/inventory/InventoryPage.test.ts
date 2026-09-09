import { describe, expect, it } from "vitest";
import { inventoryViewFromUrl } from "./InventoryPage";

describe("entrada do estoque", () => {
  it("abre o turno por padrão e preserva links das áreas especializadas", () => {
    expect(inventoryViewFromUrl("", "#/inventory")).toBe("shift");
    expect(inventoryViewFromUrl("?inventoryView=counts", "#/inventory")).toBe("counts");
    expect(inventoryViewFromUrl("", "#/inventory?inventoryView=returnables")).toBe("returnables");
    expect(inventoryViewFromUrl("?inventoryView=desconhecida", "#/inventory")).toBe("shift");
  });
});
