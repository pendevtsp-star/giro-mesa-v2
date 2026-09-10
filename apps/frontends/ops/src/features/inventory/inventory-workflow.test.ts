import { describe, expect, it } from "vitest";
import { parseInventory } from "../../management.shared";
import { inventoryItemSummaries, inventoryPrerequisites } from "./InventoryWorkspace";
import { inventoryCountContext, parseInventoryControls } from "./inventory-controls";
import { inventoryQuantity, validInventoryQuantity } from "./inventory-input";

function inventory() {
  return parseInventory({
    locations: [],
    items: [],
    balances: [],
    lots: [],
    recentMovements: [],
    automation: { pending: 0, failed: 0, lastProcessedAt: null },
  });
}

describe("estoque por setor e conferência", () => {
  it("não mistura Depósito e Bar nem inclui mercadoria em trânsito no físico", () => {
    const data = inventory();
    data.items = [
      {
        id: "beer",
        name: "Cerveja",
        unit: "un",
        active: true,
        minimumQuantity: 1,
        productId: null,
        preferredSupplierId: null,
        sku: null,
        barcode: null,
        purchaseUnit: null,
        purchaseToStockFactor: 1,
        reorderQuantity: 0,
        leadTimeDays: 0,
        allowNegative: false,
      },
    ];
    data.balances = [
      {
        inventoryItemId: "beer",
        locationId: "deposit",
        quantity: 20,
        reservedQuantity: 2,
        blockedQuantity: 1,
        availableQuantity: 17,
        averageCostCents: 500,
      },
      {
        inventoryItemId: "beer",
        locationId: "bar",
        quantity: 3,
        reservedQuantity: 1,
        blockedQuantity: 0,
        availableQuantity: 2,
        averageCostCents: 600,
      },
    ];
    data.locationItemSettings = [
      {
        inventoryItemId: "beer",
        locationId: "bar",
        minimumQuantity: 4,
        targetQuantity: 8,
        transferUnitLabel: "caixa",
        unitsPerTransferUnit: 6,
      },
    ];
    data.transfers = [
      {
        id: "transfer",
        inventoryItemId: "beer",
        sourceLocationId: "deposit",
        destinationLocationId: "bar",
        quantity: 6,
        quantityReceived: 2,
        quantityDivergent: 1,
        status: "partially_received",
        sourceLotId: null,
        destinationLotId: null,
        batchId: null,
        lineNumber: 1,
        reason: "Reposição",
        sentByName: "Ana",
        receivedByName: null,
        canceledByName: null,
        deadlineAt: "2026-09-10T12:00:00Z",
        createdAt: "2026-09-10T11:00:00Z",
        receivedAt: null,
        canceledAt: null,
        resolutionNote: null,
        receipts: [],
      },
    ];
    data.inTransitBalances = [{ inventoryItemId: "beer", quantity: 3 }];
    expect(inventoryItemSummaries(data, "bar")[0]).toMatchObject({
      quantity: 3,
      reservedQuantity: 1,
      availableQuantity: 2,
      inTransitQuantity: 3,
      averageCostCents: 600,
      low: true,
    });
    expect(inventoryItemSummaries(data, "deposit")[0]).toMatchObject({
      quantity: 20,
      availableQuantity: 17,
      inTransitQuantity: 0,
      low: false,
    });
    expect(inventoryItemSummaries(data)[0]).toMatchObject({
      quantity: 23,
      availableQuantity: 19,
      inTransitQuantity: 3,
    });
  });

  it("exige base ativa para contar ou transferir e não confunde cadastro vazio com saldo", () => {
    const data = inventory();
    expect(inventoryPrerequisites(data)).toEqual({
      canCount: false,
      canTransfer: false,
      hasPosition: false,
    });
    data.locations = [
      {
        id: "bar",
        name: "Bar",
        code: "BAR",
        kind: "bar",
        barcode: null,
        responsibleIdentityId: null,
        requireDistinctTransferReceiver: false,
        transferSlaMinutes: 30,
        active: true,
      },
    ];
    data.items = [
      {
        id: "beer",
        name: "Cerveja",
        unit: "un",
        active: true,
        minimumQuantity: 1,
        productId: null,
        preferredSupplierId: null,
        sku: null,
        barcode: null,
        purchaseUnit: null,
        purchaseToStockFactor: 1,
        reorderQuantity: 0,
        leadTimeDays: 0,
        allowNegative: false,
      },
    ];
    expect(inventoryPrerequisites(data)).toEqual({
      canCount: true,
      canTransfer: false,
      hasPosition: false,
    });
    const bar = data.locations[0];
    if (!bar) throw new Error("Fixture de setor ausente");
    const deposit = { ...bar, id: "deposit", active: false };
    data.locations.push(deposit);
    expect(inventoryPrerequisites(data).canTransfer).toBe(false);
    deposit.active = true;
    expect(inventoryPrerequisites(data).canTransfer).toBe(true);
  });

  it("seleciona sessões por setor e mantém autoria e duplo controle", () => {
    const data = parseInventoryControls({
      policies: [],
      capabilities: { canReviewCount: true, canReleaseLot: false, canChargeDeposit: false },
      lotHolds: [],
      temperatureReadings: [],
      anomalies: [],
      purchaseSuggestions: [],
      productionVariances: [],
      returnableDepositExposures: [],
      returnableDepositMode: "disabled",
      confidence: {
        score: 0,
        level: "low",
        countAccuracyPercent: 0,
        transferAccuracyPercent: 0,
        lossRatePercent: 0,
      },
      countSessions: [
        {
          id: "deposit-session",
          locationId: "deposit",
          status: "open",
          startedByIdentityId: "ana",
          reason: "Conferência",
          createdAt: "2026-09-10T12:00:00Z",
          lines: [],
        },
        {
          id: "bar-session",
          locationId: "bar",
          status: "open",
          startedByIdentityId: "bia",
          reason: "Conferência",
          createdAt: "2026-09-10T12:00:00Z",
          lines: [],
        },
      ],
    });
    expect(inventoryCountContext(data, "bar", "bia")).toMatchObject({
      open: { id: "bar-session" },
      canSubmit: true,
    });
    expect(inventoryCountContext(data, "bar", "ana").canSubmit).toBe(false);
    expect(inventoryCountContext(data, "kitchen", "ana").open).toBeUndefined();
    const barSession = data.countSessions[1];
    if (!barSession) throw new Error("Fixture de contagem ausente");
    barSession.status = "submitted";
    expect(inventoryCountContext(data, "bar", "bia").canReview).toBe(false);
    expect(inventoryCountContext(data, "bar", "ana").canReview).toBe(true);
    expect(inventoryCountContext(data, "bar").canReview).toBe(false);
  });

  it("normaliza vírgula na quantidade e exige quantidade válida antes de enviar", () => {
    expect(inventoryQuantity(" 1,250 ")).toBe("1.250");
    expect(validInventoryQuantity("1,250")).toBe(true);
    expect(validInventoryQuantity("0", true)).toBe(true);
    for (const value of ["", "-1", "0", "1,2345", "abc", "1e3"])
      expect(validInventoryQuantity(value)).toBe(false);
  });
});
