import { describe, expect, it } from "vitest";
import type { PurchaseInvoice, PurchaseOrder, PurchaseOrderItem } from "../../management.shared";
import { compatiblePurchaseOrders, parseImport } from "./InvoiceImportModal";

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

  it("oferece somente pedido aprovado com o saldo integral da NF-e", () => {
    const draft = parseImport(
      {
        import: { id: "import-1", supplierId: "supplier-1" },
        lines: [
          {
            id: "line-1",
            status: "matched",
            inventoryItemId: "item-1",
            quantity: "2",
            unitCostCents: 100,
            totalCents: 200,
          },
        ],
      },
      "",
    );
    const orders = [
      { id: "exact", status: "approved", supplierId: "supplier-1" },
      { id: "partial", status: "approved", supplierId: "supplier-1" },
    ] as PurchaseOrder[];
    const items = [
      {
        id: "line-exact",
        purchaseOrderId: "exact",
        inventoryItemId: "item-1",
        quantity: "2",
        receivedQuantity: "0",
      },
      {
        id: "line-partial",
        purchaseOrderId: "partial",
        inventoryItemId: "item-1",
        quantity: "2",
        receivedQuantity: "1",
      },
    ] as PurchaseOrderItem[];

    expect(
      compatiblePurchaseOrders(draft, "supplier-1", orders, items, [] as PurchaseInvoice[]).map(
        (order) => order.id,
      ),
    ).toEqual(["exact"]);
  });
});
