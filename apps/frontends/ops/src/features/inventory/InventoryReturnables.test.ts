import { describe, expect, it } from "vitest";
import { parseReturnables } from "../../management.shared";

describe("painel de vasilhames", () => {
  it("combina custódia prevista, saldo físico e movimentos de venda", () => {
    const parsed = parseReturnables({
      custody: [{ containerInventoryItemId: "container-1", expectedQuantity: "8" }],
      physical: [{ containerInventoryItemId: "container-1", physicalQuantity: "5" }],
      incidents: [],
      recentMovements: [
        {
          id: "movement-1",
          type: "issue",
          orderId: "order-1",
          orderItemId: "order-item-1",
          containerInventoryItemId: "container-1",
          locationId: null,
          quantityDelta: "2",
          context: { tableLabel: "Mesa 4" },
          occurredAt: "2026-08-17T00:00:00.000Z",
        },
      ],
      capabilities: {
        canConfirmCustody: true,
        canReportIncident: true,
        canApproveIncident: false,
      },
    });

    expect(parsed.returnables[0]).toMatchObject({
      inventoryItemId: "container-1",
      expectedQuantity: 8,
      physicalQuantity: 5,
      divergenceQuantity: -3,
    });
    expect(parsed.recentReturnableMovements.at(0)?.context.tableLabel).toBe("Mesa 4");
    expect(parsed.capabilities?.canRecordReturnableIncident).toBe(true);
  });
});
