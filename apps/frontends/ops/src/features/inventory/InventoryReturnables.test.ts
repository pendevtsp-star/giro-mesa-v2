import { describe, expect, it } from "vitest";
import { parseInventory, parseReturnables } from "../../management.shared";

describe("painel de vasilhames", () => {
  it("combina custódia prevista, saldo físico e movimentos de venda", () => {
    const parsed = parseReturnables({
      custody: [{ containerInventoryItemId: "container-1", expectedQuantity: "8" }],
      physical: [{ containerInventoryItemId: "container-1", physicalQuantity: "5" }],
      custodyByLocation: [
        {
          containerInventoryItemId: "container-1",
          locationId: "returns",
          expectedQuantity: "3",
        },
      ],
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
    expect(parsed.custodyByLocation[0]?.expectedQuantity).toBe(3);
    expect(parsed.capabilities?.canRecordReturnableIncident).toBe(true);
  });

  it("preserva setor, trânsito parcial e sugestão de reposição", () => {
    const parsed = parseInventory({
      locations: [
        {
          id: "freezer",
          name: "Freezer",
          code: "FRZ",
          kind: "freezer",
          barcode: "789",
          responsibleIdentityId: null,
          requireDistinctTransferReceiver: true,
          transferSlaMinutes: 15,
          active: true,
        },
      ],
      items: [],
      balances: [],
      lots: [],
      assets: [],
      inventoryReviewRequests: [],
      reservations: [],
      countSchedules: [],
      productionBatches: [],
      interunitTransfers: [],
      closings: [],
      organizationUnits: [],
      interunitCatalog: {},
      forecasts: [],
      supplierPerformance: [],
      pendingActions: [],
      recentMovements: [],
      transfers: [
        {
          id: "transfer-1",
          inventoryItemId: "beer",
          sourceLocationId: "deposit",
          destinationLocationId: "freezer",
          sourceLotId: null,
          destinationLotId: null,
          quantity: "24",
          quantityReceived: "12",
          quantityDivergent: "1",
          batchId: "batch-1",
          lineNumber: 1,
          reason: "Reposição",
          status: "partially_received",
          sentByName: "Ana",
          receivedByName: "Bia",
          canceledByName: null,
          deadlineAt: "2026-08-20T12:00:00Z",
          createdAt: "2026-08-20T11:00:00Z",
          receivedAt: null,
          canceledAt: null,
          resolutionNote: null,
          receipts: [],
        },
      ],
      inTransitBalances: [{ inventoryItemId: "beer", quantity: "11" }],
      locationItemSettings: [
        {
          locationId: "freezer",
          inventoryItemId: "beer",
          minimumQuantity: "12",
          targetQuantity: "24",
          transferUnitLabel: "caixa",
          unitsPerTransferUnit: "24",
        },
      ],
      issueRoutes: [
        {
          id: "route-1",
          productId: "product-1",
          stationId: null,
          locationId: "freezer",
          active: true,
        },
      ],
      sectorReplenishmentSuggestions: [
        {
          inventoryItemId: "beer",
          sourceLocationId: "deposit",
          destinationLocationId: "freezer",
          suggestedQuantity: "12",
          transferUnitLabel: "caixa",
          unitsPerTransferUnit: "24",
        },
      ],
      inventoryOperators: [{ id: "operator-1", name: "Ana" }],
      automation: { pending: 0, failed: 0, lastProcessedAt: null },
    });

    expect(parsed.locations[0]).toMatchObject({ kind: "freezer", transferSlaMinutes: 15 });
    expect(parsed.transfers[0]).toMatchObject({
      status: "partially_received",
      quantityReceived: 12,
      quantityDivergent: 1,
    });
    expect(parsed.sectorReplenishmentSuggestions[0]?.suggestedQuantity).toBe(12);
    expect(parsed.inventoryOperators[0]?.name).toBe("Ana");
  });
});
