import { describe, expect, it } from "vitest";
import { parseImport } from "./InvoiceImportModal";

describe("revisão de NF-e", () => {
  it("preserva status de correspondência e valores retornados pelo backend", () => {
    const parsed = parseImport(
      {
        import: {
          id: "import-1",
          accessKey: "1".repeat(44),
          documentNumber: "123",
          totalCents: 2_500,
          supplierId: "supplier-1",
        },
        lines: [
          {
            id: "line-1",
            status: "suggested",
            inventoryItemId: "item-1",
            description: "Água mineral",
            supplierProductCode: "AGUA-01",
            gtin: "7890000000000",
            purchaseUnit: "cx",
            purchaseToStockFactor: "12",
            quantity: "2",
            unitCostCents: 1_000,
            totalCents: 2_000,
          },
        ],
      },
      "",
    );

    expect(parsed.supplierId).toBe("supplier-1");
    expect(parsed.lines[0]).toMatchObject({
      status: "suggested",
      inventoryItemId: "item-1",
      totalCents: 2_000,
      factor: "12",
    });
  });
});
