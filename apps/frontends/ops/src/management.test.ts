import { describe, expect, it } from "vitest";
import {
  InvalidManagementPayloadError,
  parseCash,
  parseInventory,
  parseOverview,
  parseRecipeCatalog,
  parseRecipes,
  parseReports,
  recipeLossToBasisPoints,
  recipeQuantityToMilli,
} from "./management";

describe("dados gerenciais reais", () => {
  it("preserva estado vazio retornado pela API sem inserir fixtures", () => {
    expect(
      parseInventory({
        locations: [],
        items: [],
        balances: [],
        lots: [],
        recentMovements: [],
        automation: { pending: 0, failed: 0, lastProcessedAt: null },
      }),
    ).toEqual({
      locations: [],
      items: [],
      balances: [],
      lots: [],
      assets: [],
      inventoryReviewRequests: [],
      transfers: [],
      reservations: [],
      countSchedules: [],
      productionBatches: [],
      interunitTransfers: [],
      closings: [],
      organizationUnits: [],
      interunitCatalog: { items: [], locations: [] },
      forecasts: [],
      supplierPerformance: [],
      pendingActions: [],
      recentMovements: [],
      automation: { pending: 0, failed: 0, lastProcessedAt: null },
      capabilities: null,
    });
    expect(parseCash({ shifts: [], movements: [] })).toEqual({ shifts: [], movements: [] });
  });

  it("recusa payload inválido em vez de criar dados locais", () => {
    expect(() =>
      parseInventory({
        locations: [],
        items: "indisponível",
        balances: [],
        lots: [],
        recentMovements: [],
        automation: { pending: 0, failed: 0, lastProcessedAt: null },
      }),
    ).toThrow(InvalidManagementPayloadError);
  });

  it("preserva localização, lote e rastreabilidade do estoque real", () => {
    const parsed = parseInventory({
      locations: [{ id: "location-1", name: "Cozinha", code: "COZINHA", active: true }],
      items: [
        {
          id: "item-1",
          productId: "product-1",
          preferredSupplierId: "supplier-1",
          name: "Carne bovina",
          sku: "INS-CARNE",
          barcode: null,
          unit: "kg",
          purchaseUnit: "caixa",
          purchaseToStockFactor: "10",
          minimumQuantity: "4",
          reorderQuantity: "10",
          leadTimeDays: 1,
          allowNegative: false,
          active: true,
        },
      ],
      balances: [
        {
          locationId: "location-1",
          inventoryItemId: "item-1",
          quantity: "3.5",
          averageCostCents: 4_900,
        },
      ],
      lots: [
        {
          id: "lot-1",
          locationId: "location-1",
          inventoryItemId: "item-1",
          batchCode: "CAR-001",
          expiresAt: "2026-08-18T12:00:00.000Z",
          quantity: "3.5",
          unitCostCents: 4_900,
          active: true,
        },
      ],
      recentMovements: [
        {
          id: "movement-1",
          locationId: "location-1",
          inventoryItemId: "item-1",
          lotId: "lot-1",
          type: "purchase_receipt",
          quantityDelta: "3.5",
          unitCostCents: 4_900,
          sourceType: "purchase_receipt_line",
          actorName: "QA Dados",
          reason: "Recebimento",
          occurredAt: "2026-08-16T12:00:00.000Z",
        },
      ],
      automation: { pending: 1, failed: 0, lastProcessedAt: "2026-08-16T12:00:00.000Z" },
    });

    expect(parsed.items[0]).toMatchObject({ purchaseToStockFactor: 10, leadTimeDays: 1 });
    expect(parsed.balances[0]).toEqual({
      locationId: "location-1",
      inventoryItemId: "item-1",
      quantity: 3.5,
      reservedQuantity: 0,
      availableQuantity: 3.5,
      averageCostCents: 4_900,
    });
    expect(parsed.lots[0]?.batchCode).toBe("CAR-001");
    expect(parsed.recentMovements[0]).toMatchObject({ lotId: "lot-1", actorName: "QA Dados" });
  });

  it("preserva disponibilidade, planejamento e fechamento sem inventar dados", () => {
    const parsed = parseInventory({
      locations: [],
      items: [],
      balances: [
        {
          locationId: "location-1",
          inventoryItemId: "item-1",
          quantity: "10",
          reservedQuantity: "3",
          availableQuantity: "7",
          averageCostCents: 200,
        },
      ],
      lots: [],
      recentMovements: [],
      reservations: [
        {
          id: "reservation-1",
          inventoryItemId: "item-1",
          locationId: "location-1",
          quantity: "3",
          status: "active",
          sourceType: "event",
          sourceId: "event-1",
          reason: "Evento confirmado",
          createdAt: "2026-08-17T12:00:00.000Z",
        },
      ],
      forecasts: [
        {
          inventoryItemId: "item-1",
          horizonDays: 7,
          expectedDemand: 9,
          suggestedPurchaseQuantity: 2,
          projectedAvailableQuantity: -2,
        },
      ],
      closings: [
        {
          id: "closing-1",
          period: "2026-08-01",
          totalValueCents: 2_000,
          totalReservedValueCents: 600,
          lineCount: 1,
          closedAt: "2026-08-17T12:00:00.000Z",
        },
      ],
      automation: { pending: 0, failed: 0, lastProcessedAt: null },
    });
    expect(parsed.balances[0]).toMatchObject({
      quantity: 10,
      reservedQuantity: 3,
      availableQuantity: 7,
    });
    expect(parsed.forecasts[0]?.suggestedPurchaseQuantity).toBe(2);
    expect(parsed.closings[0]?.totalReservedValueCents).toBe(600);
  });

  it("preserva pendências, transferências e ativos operacionais", () => {
    const parsed = parseInventory({
      locations: [],
      items: [],
      balances: [],
      lots: [],
      recentMovements: [],
      assets: [
        {
          id: "asset-1",
          inventoryItemId: "item-1",
          locationId: "location-1",
          assetTag: "COPO-001",
          status: "in_use",
          condition: "good",
          version: 1,
        },
      ],
      inventoryReviewRequests: [
        {
          id: "review-1",
          type: "count",
          reason: "Divergência",
          status: "pending",
          riskSummary: { requiresApproval: true },
          requestedByIdentityId: "identity-1",
          createdAt: "2026-08-17T12:00:00.000Z",
        },
      ],
      transfers: [
        {
          id: "transfer-1",
          inventoryItemId: "item-1",
          sourceLocationId: "location-1",
          destinationLocationId: "location-2",
          quantity: "12",
          reason: "Reposição",
          status: "in_transit",
          createdAt: "2026-08-17T12:00:00.000Z",
        },
      ],
      pendingActions: [
        {
          id: "review:review-1",
          type: "inventory_review",
          priority: "high",
          title: "Contagem pendente",
          detail: "Requer segunda conferência",
          createdAt: "2026-08-17T12:00:00.000Z",
        },
      ],
      automation: { pending: 0, failed: 0, lastProcessedAt: null },
      capabilities: {
        canApproveInventoryRisk: true,
        canResolveTransfers: true,
        canManageAssets: true,
      },
    });

    expect(parsed.assets[0]).toMatchObject({ assetTag: "COPO-001", version: 1 });
    expect(parsed.inventoryReviewRequests[0]?.status).toBe("pending");
    expect(parsed.transfers[0]).toMatchObject({ quantity: 12, status: "in_transit" });
    expect(parsed.pendingActions[0]?.priority).toBe("high");
    expect(parsed.capabilities?.canManageAssets).toBe(true);
  });

  it("valida o cockpit por perfil e recusa rotas não autorizáveis", () => {
    const payload = {
      profileId: "waiter",
      generatedAt: "2026-08-16T22:00:00.000Z",
      activeShift: { label: "Jantar", startsAt: "2026-08-16T21:00:00.000Z" },
      unavailableSources: [],
      sources: [{ id: "operations", status: "fresh", checkedAt: "2026-08-16T22:00:00.000Z" }],
      activity: [],
      multiunit: [],
      preferences: {
        alertsEnabled: true,
        minimumTone: "warning",
        digestMinutes: 15,
        thresholds: {
          kdsDelayMinutes: 15,
          stockCoverageDays: 3,
          deliveryRiskMinutes: 15,
          salesGoalCents: 100_000,
          maxKdsDelayed: 2,
          maxStockouts: 0,
          maxDeliveryDelayed: 0,
          maxReconciliations: 0,
        },
      },
      lastVisitedAt: null,
      partialSource: null,
      metrics: [
        {
          id: "my-tables",
          label: "Minhas mesas",
          value: "3",
          detail: "1 pediu a conta",
          tone: "warning",
          route: "salon",
          source: "operations",
        },
      ],
      priorities: [
        {
          id: "oldest-call",
          title: "Atender Mesa 03",
          detail: "Chamado aberto há 4 min",
          tone: "danger",
          route: "salon",
          actionLabel: "Assumir chamado",
          source: "operations",
          occurrenceKey: "call-1",
          status: "open",
          assignedTo: null,
        },
      ],
      pulse: [
        { id: "guests", label: "Clientes", value: "8", route: "salon", source: "operations" },
      ],
      quickActions: [{ id: "new-tab", label: "Abrir atendimento", route: "counter" }],
    };

    expect(parseOverview(payload)).toMatchObject({
      profileId: "waiter",
      metrics: [{ id: "my-tables" }],
    });
    expect(() =>
      parseOverview({
        ...payload,
        quickActions: [{ id: "unsafe", label: "Abrir", route: "javascript:alert(1)" }],
      }),
    ).toThrow(InvalidManagementPayloadError);
  });

  it("interpreta fluxo de caixa e DRE sem inventar CMV ausente", () => {
    expect(
      parseReports({
        period: { from: "2026-08-01", to: "2026-08-31" },
        cashFlow: {
          inflowsCents: 120_000,
          outflowsCents: 45_000,
          netCents: 75_000,
          basis: "realized_payments_utc",
        },
        incomeStatement: {
          revenueCents: 150_000,
          cmvCents: null,
          grossMarginCents: null,
          operatingExpensesCents: 50_000,
          operatingResultCents: null,
          costCoverage: {
            coverage: "partial",
            missingCostLines: 2,
            completeForRevenue: false,
          },
          basis: "competence",
        },
      }).incomeStatement,
    ).toMatchObject({ cmvCents: null, operatingResultCents: null });
  });

  it("interpreta produtos e a versão ativa com componentes reais", () => {
    expect(
      parseRecipeCatalog({
        products: [{ id: "product-1", name: "Burger da casa", active: true }],
      }),
    ).toEqual({
      products: [{ id: "product-1", name: "Burger da casa", active: true }],
    });
    expect(
      parseRecipes([
        {
          id: "recipe-1",
          productId: "product-1",
          version: 3,
          validFrom: "2026-08-10T15:00:00.000Z",
          validUntil: null,
          components: [
            {
              inventoryItemId: "item-1",
              locationId: "location-1",
              quantityMilli: 180,
              lossBasisPoints: 250,
            },
          ],
        },
      ]),
    ).toEqual([
      {
        id: "recipe-1",
        productId: "product-1",
        version: 3,
        validFrom: "2026-08-10T15:00:00.000Z",
        validUntil: null,
        components: [
          {
            inventoryItemId: "item-1",
            locationId: "location-1",
            quantityMilli: 180,
            lossBasisPoints: 250,
          },
        ],
      },
    ]);
  });

  it("converte quantidade e perda sem arredondamento operacional silencioso", () => {
    expect(recipeQuantityToMilli("1,250")).toBe(1_250);
    expect(recipeQuantityToMilli("0.001")).toBe(1);
    expect(recipeLossToBasisPoints("2,50")).toBe(250);
    expect(recipeLossToBasisPoints("0")).toBe(0);
    expect(() => recipeQuantityToMilli("0")).toThrow(/maior que zero/i);
    expect(() => recipeQuantityToMilli("0,0001")).toThrow(/três casas/i);
    expect(() => recipeLossToBasisPoints("100")).toThrow(/99,99%/i);
    expect(() => recipeLossToBasisPoints("2,505")).toThrow(/duas casas/i);
  });
});
