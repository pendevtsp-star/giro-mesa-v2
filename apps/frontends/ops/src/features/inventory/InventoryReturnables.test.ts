import { describe, expect, it } from "vitest";
import {
  aggregateReturnableReconciliation,
  parseInventory,
  parseReturnablePolicy,
  parseReturnables,
} from "../../management.shared";

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
      openCustodies: [
        {
          id: "movement-1",
          containerInventoryItemId: "container-1",
          locationId: null,
          orderId: "order-1",
          orderItemId: "order-item-1",
          responsibleIdentityId: "identity-1",
          counterpartyName: "Mesa 4",
          dueAt: "2026-08-18T00:00:00.000Z",
          openQuantity: "2",
          depositCents: 500,
          occurredAt: "2026-08-17T00:00:00.000Z",
        },
      ],
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
    expect(parsed.openCustodies[0]).toMatchObject({ id: "movement-1", openQuantity: 2 });
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

  it("interpreta o contrato operacional por setor sem inventar divergência físico-previsto", () => {
    const parsed = parseReturnables({
      policy: {
        depositMode: "disabled",
        defaultDueDays: 7,
        returnableClosePolicy: "warn",
      },
      custodyInbox: [
        {
          issueMovementId: "issue-1",
          orderId: "order-1",
          orderCode: "P-1042",
          tableLabel: "Mesa 12",
          responsibleIdentityId: "person-1",
          responsibleName: "Ana",
          locationId: "bar",
          inventoryItemId: "bottle-1",
          issuedQuantity: "12",
          returnedQuantity: "4",
          outstandingQuantity: "8",
          dueAt: "2026-08-27T12:00:00.000Z",
          oldestOutstandingAt: "2026-08-25T12:00:00.000Z",
          ageDays: 2,
          depositExposureCents: 800,
        },
      ],
      reconciliation: {
        totals: [
          {
            containerInventoryItemId: "bottle-1",
            fullEquivalentQuantity: "24",
            emptyPhysicalQuantity: "10",
            openCustodyQuantity: "8",
            supplierInTransitQuantity: "2",
            approvedLossQuantity: "1",
            explainableBalanceQuantity: "45",
            recentCountDifferenceQuantity: "-1",
          },
          {
            containerInventoryItemId: "crate-1",
            fullEquivalentQuantity: "6",
            emptyPhysicalQuantity: "3",
            openCustodyQuantity: "2",
            supplierInTransitQuantity: "0",
            approvedLossQuantity: "0",
            explainableBalanceQuantity: "11",
            recentCountDifferenceQuantity: "1",
          },
        ],
        byLocation: [
          {
            containerInventoryItemId: "bottle-1",
            locationId: "bar",
            fullEquivalentQuantity: "12",
            emptyPhysicalQuantity: "5",
            openCustodyQuantity: "8",
            supplierInTransitQuantity: "0",
            approvedLossQuantity: "1",
            explainableBalanceQuantity: "26",
            lastCountedAt: "2026-08-25T18:00:00.000Z",
            lastCountDifferenceQuantity: "-1",
          },
        ],
      },
      classificationStatus: [
        {
          productId: "beer-1",
          productName: "Cerveja",
          status: "returnable",
          activeLink: {
            containerInventoryItemId: "bottle-1",
            quantityPerUnit: "1",
            depositCents: 100,
            containerActive: true,
          },
        },
      ],
      configurationHealth: {
        undecidedProductIds: [],
        unlinkedReturnableProductIds: [],
        missingDepositValueProductIds: [],
        inactiveContainerLinkProductIds: [],
      },
      capabilities: {
        canConfirmReturnables: true,
        canConfigurePolicy: true,
        canHandoffCustody: true,
        canConfigure: true,
        canManageDeposit: true,
      },
    });

    expect(parsed.openCustodies[0]).toMatchObject({
      id: "issue-1",
      inventoryItemId: "bottle-1",
      openQuantity: 8,
      occurredAt: "2026-08-25T12:00:00.000Z",
    });
    expect(parsed.reconciliation.totals).toMatchObject({
      fullEquivalentQuantity: 30,
      explainableBalanceQuantity: 56,
      lastCountDifferenceQuantity: 0,
    });
    expect(parsed.reconciliation.byLocation[0]).toMatchObject({
      inventoryItemId: "bottle-1",
      lastCountDifferenceQuantity: -1,
    });
    expect(parsed.classificationStatus[0]).toMatchObject({
      classification: "returnable",
      containerInventoryItemId: "bottle-1",
      active: true,
    });
    expect(parsed.capabilities).toMatchObject({
      canManageReturnablePolicy: true,
      canTransferReturnableResponsibility: true,
      canConfigureReturnables: true,
      canManageReturnableDeposits: true,
    });
    expect(parseReturnablePolicy(parsed.policy ?? {})).toEqual({
      depositMode: "disabled",
      defaultDueDays: 7,
      returnableClosePolicy: "warn",
    });
    expect(
      aggregateReturnableReconciliation(parsed.reconciliation.byLocation)
        .lastCountDifferenceQuantity,
    ).toBe(-1);
  });
});
