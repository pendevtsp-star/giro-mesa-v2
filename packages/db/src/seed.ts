import { pathToFileURL } from "node:url";
import { eq, inArray } from "drizzle-orm";
import {
  createDatabase,
  type Database,
  growthIntegrations,
  identities,
  managementAccountsPayable,
  managementAccountsReceivable,
  managementCashShifts,
  managementInventoryEventLines,
  managementInventoryEvents,
  managementInventoryItems,
  managementInventoryMovements,
  managementReceivablePayments,
  managementStockBalances,
  managementStockLocations,
  managementSuppliers,
  memberships,
  organizations,
  posCatalogCategories,
  posDiningRooms,
  posDiningTables,
  posKdsTicketItems,
  posKdsTickets,
  posOrderItems,
  posOrders,
  posProductionStations,
  posProductPrices,
  posProductStations,
  posProducts,
  posTabs,
  roleBindings,
  units,
} from "./index.js";
import { commercialCatalogVersions, commercialPlans } from "./schema.js";
import { demoSeedConfiguration } from "./seed-policy.js";

// The default seed is intentionally limited to the public commercial catalog.
// Task 35 may opt into demo data only through this fail-closed policy.
demoSeedConfiguration(process.env);

export const DEMO_RESET_CONFIRMATION = "RESET_GIROMESA_DEMO";

const plans = [
  {
    slug: "operacao",
    name: "Operação",
    monthly: 14_900,
    units: 1,
    entitlements: [
      "salon",
      "counter",
      "kds",
      "cashier",
      "offline_hub",
      "qr_ordering",
      "inventory",
      "purchasing",
      "finance",
      "basic_crm",
      "reports",
    ],
  },
  {
    slug: "crescimento",
    name: "Crescimento",
    monthly: 29_900,
    units: 1,
    entitlements: [
      "salon",
      "counter",
      "kds",
      "cashier",
      "offline_hub",
      "qr_ordering",
      "inventory",
      "purchasing",
      "finance",
      "basic_crm",
      "reports",
      "delivery",
      "pickup",
      "advanced_crm",
      "loyalty",
      "campaigns",
      "reconciliation",
      "integrations",
    ],
  },
  {
    slug: "rede",
    name: "Rede",
    monthly: 49_900,
    units: 3,
    entitlements: [
      "all_growth",
      "multi_unit",
      "public_api",
      "webhooks",
      "advanced_audit",
      "priority_sla",
    ],
  },
] as const;

function demoUuid(group: number, sequence: number): string {
  return `35000000-${group.toString().padStart(4, "0")}-4000-8000-${sequence
    .toString()
    .padStart(12, "0")}`;
}

const DEMO_ORGANIZATION_ID = demoUuid(1, 1);
const DEMO_UNIT_IDS = [demoUuid(2, 1), demoUuid(2, 2)] as const;
const DEMO_ROLE_NAMES = [
  "owner",
  "manager",
  "waiter",
  "cashier",
  "kds",
  "inventory",
  "finance",
] as const;

export function createDemoSeedPlan() {
  const referenceTime = new Date("2026-08-10T18:00:00.000Z");
  const identityRows: (typeof identities.$inferInsert)[] = DEMO_ROLE_NAMES.map((role, index) => ({
    id: demoUuid(10, index + 1),
    email: `${role}.demo@invalid.example`,
    displayName: `[DEMO] ${role}`,
    kind: "human",
    emailVerifiedAt: referenceTime,
    createdAt: referenceTime,
    updatedAt: referenceTime,
  }));
  const membershipRows: (typeof memberships.$inferInsert)[] = identityRows.map((_, index) => ({
    id: demoUuid(11, index + 1),
    identityId: demoUuid(10, index + 1),
    organizationId: DEMO_ORGANIZATION_ID,
    status: "active",
    createdAt: referenceTime,
    updatedAt: referenceTime,
  }));
  const roleBindingRows: (typeof roleBindings.$inferInsert)[] = membershipRows.map((_, index) => ({
    id: demoUuid(12, index + 1),
    membershipId: demoUuid(11, index + 1),
    unitId: index === 0 ? null : DEMO_UNIT_IDS[0],
    role: DEMO_ROLE_NAMES[index] ?? "waiter",
    createdAt: referenceTime,
  }));
  const roomNames = ["Salão principal", "Varanda", "Balcão"] as const;
  const roomRows: (typeof posDiningRooms.$inferInsert)[] = roomNames.map((name, index) => ({
    id: demoUuid(20, index + 1),
    organizationId: DEMO_ORGANIZATION_ID,
    unitId: DEMO_UNIT_IDS[0],
    name,
    sortOrder: index,
    active: true,
    createdAt: referenceTime,
    updatedAt: referenceTime,
  }));
  const tableStatuses = ["available", "occupied", "available", "reserved"] as const;
  const tableRows: (typeof posDiningTables.$inferInsert)[] = Array.from(
    { length: 120 },
    (_, index) => ({
      id: demoUuid(21, index + 1),
      organizationId: DEMO_ORGANIZATION_ID,
      unitId: DEMO_UNIT_IDS[0],
      roomId: roomRows[Math.floor(index / 40)]?.id ?? roomRows[0]?.id ?? demoUuid(20, 1),
      label: `Mesa ${String(index + 1).padStart(3, "0")}`,
      seats: [2, 4, 4, 6][index % 4] ?? 4,
      status: tableStatuses[index % tableStatuses.length] ?? "available",
      active: true,
      createdAt: referenceTime,
      updatedAt: referenceTime,
    }),
  );
  const stationRows: (typeof posProductionStations.$inferInsert)[] = [
    {
      id: demoUuid(22, 1),
      organizationId: DEMO_ORGANIZATION_ID,
      unitId: DEMO_UNIT_IDS[0],
      name: "Cozinha demonstrativa",
      code: "DEMO-KITCHEN",
      active: true,
      createdAt: referenceTime,
      updatedAt: referenceTime,
    },
    {
      id: demoUuid(22, 2),
      organizationId: DEMO_ORGANIZATION_ID,
      unitId: DEMO_UNIT_IDS[0],
      name: "Bar demonstrativo",
      code: "DEMO-BAR",
      active: true,
      createdAt: referenceTime,
      updatedAt: referenceTime,
    },
  ];
  const categoryRows: (typeof posCatalogCategories.$inferInsert)[] = [
    {
      id: demoUuid(23, 1),
      organizationId: DEMO_ORGANIZATION_ID,
      name: "Produtos demonstrativos",
      slug: "demo-products",
      sortOrder: 1,
      active: true,
      createdAt: referenceTime,
      updatedAt: referenceTime,
    },
  ];
  const productRows: (typeof posProducts.$inferInsert)[] = [
    {
      id: demoUuid(24, 1),
      organizationId: DEMO_ORGANIZATION_ID,
      categoryId: categoryRows[0]?.id ?? demoUuid(23, 1),
      sku: "DEMO-BURGER",
      name: "Burger demonstrativo",
      description: "Produto exclusivamente demonstrativo",
      active: true,
      createdAt: referenceTime,
      updatedAt: referenceTime,
    },
    {
      id: demoUuid(24, 2),
      organizationId: DEMO_ORGANIZATION_ID,
      categoryId: categoryRows[0]?.id ?? demoUuid(23, 1),
      sku: "DEMO-LEMONADE",
      name: "Limonada demonstrativa",
      description: "Produto exclusivamente demonstrativo",
      active: true,
      createdAt: referenceTime,
      updatedAt: referenceTime,
    },
  ];
  const productPriceRows: (typeof posProductPrices.$inferInsert)[] = productRows.map(
    (_, index) => ({
      organizationId: DEMO_ORGANIZATION_ID,
      unitId: DEMO_UNIT_IDS[0],
      productId: demoUuid(24, index + 1),
      priceCents: index === 0 ? 3_890 : 1_450,
      createdAt: referenceTime,
      updatedAt: referenceTime,
    }),
  );
  const productStationRows: (typeof posProductStations.$inferInsert)[] = productRows.map(
    (_, index) => ({
      organizationId: DEMO_ORGANIZATION_ID,
      unitId: DEMO_UNIT_IDS[0],
      productId: demoUuid(24, index + 1),
      stationId: stationRows[index]?.id ?? stationRows[0]?.id ?? demoUuid(22, 1),
    }),
  );
  const tabRows: (typeof posTabs.$inferInsert)[] = Array.from({ length: 4 }, (_, index) => ({
    id: demoUuid(25, index + 1),
    organizationId: DEMO_ORGANIZATION_ID,
    unitId: DEMO_UNIT_IDS[0],
    tableId: tableRows[index * 4 + 1]?.id,
    openedByIdentityId: identityRows[2]?.id ?? demoUuid(10, 3),
    label: `[DEMO] Comanda ${index + 1}`,
    guestCount: index + 2,
    status: "open",
    serviceChargeBasisPoints: 1_000,
    subtotalCents: 3_890 + index * 1_450,
    discountCents: 0,
    serviceChargeCents: 389 + index * 145,
    tipCents: 0,
    totalCents: 4_279 + index * 1_595,
    createdAt: referenceTime,
    updatedAt: referenceTime,
  }));
  const orderRows: (typeof posOrders.$inferInsert)[] = tabRows.map((_, index) => ({
    id: demoUuid(26, index + 1),
    organizationId: DEMO_ORGANIZATION_ID,
    unitId: DEMO_UNIT_IDS[0],
    tabId: demoUuid(25, index + 1),
    createdByIdentityId: identityRows[2]?.id ?? demoUuid(10, 3),
    status: index === 0 ? "sent" : index === 2 ? "ready" : "preparing",
    sentAt: referenceTime,
    createdAt: referenceTime,
    updatedAt: referenceTime,
  }));
  const orderItemRows: (typeof posOrderItems.$inferInsert)[] = orderRows.map((_, index) => {
    const product = productRows[index % productRows.length] ?? productRows[0];
    const unitPriceCents = index % 2 === 0 ? 3_890 : 1_450;
    return {
      id: demoUuid(27, index + 1),
      organizationId: DEMO_ORGANIZATION_ID,
      unitId: DEMO_UNIT_IDS[0],
      orderId: demoUuid(26, index + 1),
      productId: product?.id ?? demoUuid(24, 1),
      stationId: stationRows[index % stationRows.length]?.id,
      productName: product?.name ?? "Produto demonstrativo",
      quantity: 1,
      unitPriceCents,
      modifiersCents: 0,
      grossCents: unitPriceCents,
      discountCents: 0,
      netCents: unitPriceCents,
      status: index === 0 ? "queued" : index === 2 ? "ready" : "preparing",
      notes: "Pedido exclusivamente demonstrativo",
      createdAt: referenceTime,
      updatedAt: referenceTime,
    };
  });
  const kdsStatuses = ["pending", "preparing", "ready", "preparing"] as const;
  const kdsTicketRows: (typeof posKdsTickets.$inferInsert)[] = orderRows.map((_, index) => ({
    id: demoUuid(28, index + 1),
    organizationId: DEMO_ORGANIZATION_ID,
    unitId: DEMO_UNIT_IDS[0],
    orderId: demoUuid(26, index + 1),
    stationId: stationRows[index % stationRows.length]?.id ?? demoUuid(22, 1),
    status: kdsStatuses[index] ?? "pending",
    startedAt: index === 0 ? null : referenceTime,
    readyAt: index === 2 ? referenceTime : null,
    createdAt: referenceTime,
    updatedAt: referenceTime,
  }));
  const kdsTicketItemRows: (typeof posKdsTicketItems.$inferInsert)[] = kdsTicketRows.map(
    (_, index) => ({
      organizationId: DEMO_ORGANIZATION_ID,
      unitId: DEMO_UNIT_IDS[0],
      ticketId: demoUuid(28, index + 1),
      orderItemId: orderItemRows[index]?.id ?? demoUuid(27, index + 1),
    }),
  );
  const supplierRows: (typeof managementSuppliers.$inferInsert)[] = [
    {
      id: demoUuid(30, 1),
      organizationId: DEMO_ORGANIZATION_ID,
      unitId: DEMO_UNIT_IDS[0],
      name: "[DEMO] Fornecedor local",
      document: null,
      contactName: "Contato demonstrativo",
      email: "supplier.demo@invalid.example",
      phone: null,
      active: true,
      createdAt: referenceTime,
      updatedAt: referenceTime,
    },
  ];
  const stockLocationRows: (typeof managementStockLocations.$inferInsert)[] = [
    {
      id: demoUuid(31, 1),
      organizationId: DEMO_ORGANIZATION_ID,
      unitId: DEMO_UNIT_IDS[0],
      name: "Estoque principal demonstrativo",
      code: "DEMO-MAIN",
      active: true,
      createdAt: referenceTime,
      updatedAt: referenceTime,
    },
    {
      id: demoUuid(31, 2),
      organizationId: DEMO_ORGANIZATION_ID,
      unitId: DEMO_UNIT_IDS[0],
      name: "Bar demonstrativo",
      code: "DEMO-BAR",
      active: true,
      createdAt: referenceTime,
      updatedAt: referenceTime,
    },
  ];
  const inventoryDefinitions = [
    ["DEMO-BEEF", "Carne burger 160 g", "un", "24.000"],
    ["DEMO-RICE", "Arroz arbóreo", "kg", "5.000"],
    ["DEMO-LEMON", "Limão siciliano", "kg", "4.000"],
    ["DEMO-CHEESE", "Queijo meia cura", "kg", "3.000"],
    ["DEMO-MASCARPONE", "Mascarpone", "kg", "2.000"],
    ["DEMO-RET-KEG", "Barril retornável 30 L", "un", "2.000"],
    ["DEMO-RET-CRATE", "Engradado retornável", "un", "4.000"],
    ["DEMO-RET-BOTTLE", "Garrafa retornável 600 ml", "un", "24.000"],
  ] as const;
  const inventoryItemRows: (typeof managementInventoryItems.$inferInsert)[] =
    inventoryDefinitions.map(([sku, name, unit, minimumQuantity], index) => ({
      id: demoUuid(32, index + 1),
      organizationId: DEMO_ORGANIZATION_ID,
      unitId: DEMO_UNIT_IDS[0],
      name,
      sku,
      unit,
      minimumQuantity,
      allowNegative: false,
      active: true,
      createdAt: referenceTime,
      updatedAt: referenceTime,
    }));
  const stockBalanceRows: (typeof managementStockBalances.$inferInsert)[] = inventoryItemRows.map(
    (_, index) => ({
      id: demoUuid(33, index + 1),
      organizationId: DEMO_ORGANIZATION_ID,
      unitId: DEMO_UNIT_IDS[0],
      locationId: stockLocationRows[index % stockLocationRows.length]?.id ?? demoUuid(31, 1),
      inventoryItemId: demoUuid(32, index + 1),
      quantity: ["18.000", "6.400", "2.100", "7.300", "0.000", "3.000", "8.000", "48.000"][index],
      averageCostCents: [920, 3_280, 1_680, 5_840, 7_470, 18_000, 2_400, 180][index],
      version: 1,
      createdAt: referenceTime,
      updatedAt: referenceTime,
    }),
  );
  const inventoryEventRows: (typeof managementInventoryEvents.$inferInsert)[] = [
    {
      id: demoUuid(34, 1),
      organizationId: DEMO_ORGANIZATION_ID,
      unitId: DEMO_UNIT_IDS[0],
      type: "loss",
      reason: "Quebra registrada para análise gerencial demonstrativa",
      idempotencyKey: "demo-incident-breakage-v1",
      actorIdentityId: identityRows[5]?.id ?? demoUuid(10, 6),
      occurredAt: referenceTime,
      createdAt: referenceTime,
      updatedAt: referenceTime,
    },
    {
      id: demoUuid(34, 2),
      organizationId: DEMO_ORGANIZATION_ID,
      unitId: DEMO_UNIT_IDS[0],
      type: "adjustment",
      reason: "Vasilhame ausente aguardando conferência demonstrativa",
      idempotencyKey: "demo-incident-returnable-v1",
      actorIdentityId: identityRows[5]?.id ?? demoUuid(10, 6),
      occurredAt: referenceTime,
      createdAt: referenceTime,
      updatedAt: referenceTime,
    },
  ];
  const eventInventoryIndexes = [0, 7] as const;
  const inventoryEventLineRows: (typeof managementInventoryEventLines.$inferInsert)[] =
    inventoryEventRows.map((_, index) => {
      const balance = stockBalanceRows[eventInventoryIndexes[index] ?? 0];
      return {
        id: demoUuid(35, index + 1),
        organizationId: DEMO_ORGANIZATION_ID,
        unitId: DEMO_UNIT_IDS[0],
        eventId: demoUuid(34, index + 1),
        locationId: balance?.locationId ?? demoUuid(31, 1),
        inventoryItemId: balance?.inventoryItemId ?? demoUuid(32, 1),
        previousQuantity: index === 0 ? "19.000" : "49.000",
        quantityDelta: "-1.000",
        resultingQuantity: index === 0 ? "18.000" : "48.000",
      };
    });
  const inventoryMovementRows: (typeof managementInventoryMovements.$inferInsert)[] =
    inventoryEventRows.map((_, index) => {
      const line = inventoryEventLineRows[index];
      return {
        id: demoUuid(36, index + 1),
        organizationId: DEMO_ORGANIZATION_ID,
        unitId: DEMO_UNIT_IDS[0],
        locationId: line?.locationId ?? demoUuid(31, 1),
        inventoryItemId: line?.inventoryItemId ?? demoUuid(32, 1),
        type: index === 0 ? "loss" : "adjustment",
        quantityDelta: "-1.000",
        sourceType: "demo_inventory_event",
        sourceId: demoUuid(34, index + 1),
        actorIdentityId: identityRows[5]?.id ?? demoUuid(10, 6),
        occurredAt: referenceTime,
        createdAt: referenceTime,
        updatedAt: referenceTime,
      };
    });
  const payableRows: (typeof managementAccountsPayable.$inferInsert)[] = [
    {
      id: demoUuid(40, 1),
      organizationId: DEMO_ORGANIZATION_ID,
      unitId: DEMO_UNIT_IDS[0],
      supplierId: supplierRows[0]?.id,
      description: "Compra demonstrativa de insumos",
      status: "open",
      amountCents: 184_000,
      paidCents: 0,
      competenceDate: "2026-08-10",
      dueDate: "2026-08-17",
      idempotencyKey: "demo-payable-v1",
      version: 1,
      createdAt: referenceTime,
      updatedAt: referenceTime,
    },
  ];
  const paymentAmounts = [14_680, 28_740, 9_230] as const;
  const receivableRows: (typeof managementAccountsReceivable.$inferInsert)[] = paymentAmounts.map(
    (amountCents, index) => ({
      id: demoUuid(41, index + 1),
      organizationId: DEMO_ORGANIZATION_ID,
      unitId: DEMO_UNIT_IDS[0],
      sourceOrderId: orderRows[index]?.id,
      description: `Recebimento demonstrativo ${index + 1}`,
      status: "received",
      amountCents,
      receivedCents: amountCents,
      competenceDate: "2026-08-10",
      dueDate: "2026-08-10",
      idempotencyKey: `demo-receivable-${index + 1}-v1`,
      version: 1,
      createdAt: referenceTime,
      updatedAt: referenceTime,
    }),
  );
  const cashShiftRows: (typeof managementCashShifts.$inferInsert)[] = [
    {
      id: demoUuid(42, 1),
      organizationId: DEMO_ORGANIZATION_ID,
      unitId: DEMO_UNIT_IDS[0],
      operatorIdentityId: identityRows[3]?.id ?? demoUuid(10, 4),
      status: "open",
      openingCents: 20_000,
      expectedCents: 72_650,
      openedAt: referenceTime,
      openIdempotencyKey: "demo-cash-shift-v1",
      version: 1,
      createdAt: referenceTime,
      updatedAt: referenceTime,
    },
  ];
  const paymentMethods = ["cash", "debit_simulator", "voucher_simulator"] as const;
  const receivablePaymentRows: (typeof managementReceivablePayments.$inferInsert)[] =
    receivableRows.map((_, index) => ({
      id: demoUuid(43, index + 1),
      organizationId: DEMO_ORGANIZATION_ID,
      unitId: DEMO_UNIT_IDS[0],
      receivableId: demoUuid(41, index + 1),
      cashShiftId: demoUuid(42, 1),
      amountCents: paymentAmounts[index] ?? 0,
      method: paymentMethods[index] ?? "cash",
      reference: `demo-local-reference-${index + 1}`,
      idempotencyKey: `demo-payment-${index + 1}-v1`,
      receivedByIdentityId: identityRows[3]?.id ?? demoUuid(10, 4),
      receivedAt: referenceTime,
      createdAt: referenceTime,
      updatedAt: referenceTime,
    }));
  const integrationRows: (typeof growthIntegrations.$inferInsert)[] = [
    {
      id: demoUuid(50, 1),
      organizationId: DEMO_ORGANIZATION_ID,
      unitId: DEMO_UNIT_IDS[0],
      provider: "doseclub",
      status: "disabled",
      credentialReference: null,
      config: {
        demoOnly: true,
        mode: "simulator",
        mappingCount: 3,
        pendingReconciliationCount: 1,
      },
      createdAt: referenceTime,
      updatedAt: referenceTime,
    },
  ];

  return {
    organization: {
      id: DEMO_ORGANIZATION_ID,
      legalName: "[DEMO] Grupo Aurora Ltda.",
      tradeName: "[DEMO] Grupo Aurora",
      document: "00000000003500",
      billingState: "trial_active" as const,
      billingStateChangedAt: referenceTime,
      createdAt: referenceTime,
      updatedAt: referenceTime,
    },
    units: [
      {
        id: DEMO_UNIT_IDS[0],
        organizationId: DEMO_ORGANIZATION_ID,
        name: "[DEMO] Aurora Centro",
        timezone: "America/Sao_Paulo",
        active: true,
        createdAt: referenceTime,
        updatedAt: referenceTime,
      },
      {
        id: DEMO_UNIT_IDS[1],
        organizationId: DEMO_ORGANIZATION_ID,
        name: "[DEMO] Aurora Lagoa",
        timezone: "America/Sao_Paulo",
        active: true,
        createdAt: referenceTime,
        updatedAt: referenceTime,
      },
    ] satisfies (typeof units.$inferInsert)[],
    identities: identityRows,
    memberships: membershipRows,
    roleBindings: roleBindingRows,
    rooms: roomRows,
    tables: tableRows,
    stations: stationRows,
    categories: categoryRows,
    products: productRows,
    productPrices: productPriceRows,
    productStations: productStationRows,
    tabs: tabRows,
    orders: orderRows,
    orderItems: orderItemRows,
    kdsTickets: kdsTicketRows,
    kdsTicketItems: kdsTicketItemRows,
    suppliers: supplierRows,
    stockLocations: stockLocationRows,
    inventoryItems: inventoryItemRows,
    stockBalances: stockBalanceRows,
    inventoryEvents: inventoryEventRows,
    inventoryEventLines: inventoryEventLineRows,
    inventoryMovements: inventoryMovementRows,
    returnableInventoryItemIds: inventoryItemRows.slice(-3).map((item) => item.id),
    payables: payableRows,
    receivables: receivableRows,
    cashShifts: cashShiftRows,
    receivablePayments: receivablePaymentRows,
    growthIntegrations: integrationRows,
  };
}

export function assertDemoResetAllowed(connectionString: string, confirmation: string | undefined) {
  if (confirmation !== DEMO_RESET_CONFIRMATION) {
    throw new Error(`GIROMESA_DEMO_RESET_CONFIRM must equal ${DEMO_RESET_CONFIRMATION}.`);
  }
  const parsed = new URL(connectionString);
  const databaseName = parsed.pathname.replace(/^\//, "");
  if (!databaseName.endsWith("_demo")) {
    throw new Error("The demo database name must end with _demo.");
  }
}

async function seedCommercialCatalog(db: Database) {
  const existing = await db
    .select()
    .from(commercialCatalogVersions)
    .where(eq(commercialCatalogVersions.version, 1))
    .limit(1);
  const catalog =
    existing[0] ??
    (
      await db
        .insert(commercialCatalogVersions)
        .values({ version: 1, status: "published", publishedAt: new Date() })
        .returning()
    )[0];
  if (!catalog) throw new Error("Could not create commercial catalog");
  for (const plan of plans) {
    await db
      .insert(commercialPlans)
      .values({
        catalogVersionId: catalog.id,
        slug: plan.slug,
        name: plan.name,
        monthlyPriceCents: plan.monthly,
        annualPriceCents: plan.monthly * 10,
        includedUnits: plan.units,
        entitlements: [...plan.entitlements],
      })
      .onConflictDoNothing();
  }
}

export async function resetDemoTenant(db: Database) {
  const plan = createDemoSeedPlan();
  await db.transaction(async (tx) => {
    await tx
      .delete(posKdsTicketItems)
      .where(eq(posKdsTicketItems.organizationId, plan.organization.id));
    await tx.delete(posKdsTickets).where(eq(posKdsTickets.organizationId, plan.organization.id));
    await tx.delete(posOrderItems).where(eq(posOrderItems.organizationId, plan.organization.id));
    await tx
      .delete(managementReceivablePayments)
      .where(eq(managementReceivablePayments.organizationId, plan.organization.id));
    await tx
      .delete(managementAccountsReceivable)
      .where(eq(managementAccountsReceivable.organizationId, plan.organization.id));
    await tx
      .delete(managementAccountsPayable)
      .where(eq(managementAccountsPayable.organizationId, plan.organization.id));
    await tx
      .delete(managementCashShifts)
      .where(eq(managementCashShifts.organizationId, plan.organization.id));
    await tx.delete(posOrders).where(eq(posOrders.organizationId, plan.organization.id));
    await tx.delete(posTabs).where(eq(posTabs.organizationId, plan.organization.id));
    await tx
      .delete(managementInventoryMovements)
      .where(eq(managementInventoryMovements.organizationId, plan.organization.id));
    await tx
      .delete(managementInventoryEventLines)
      .where(eq(managementInventoryEventLines.organizationId, plan.organization.id));
    await tx
      .delete(managementInventoryEvents)
      .where(eq(managementInventoryEvents.organizationId, plan.organization.id));
    await tx
      .delete(managementStockBalances)
      .where(eq(managementStockBalances.organizationId, plan.organization.id));
    await tx
      .delete(managementInventoryItems)
      .where(eq(managementInventoryItems.organizationId, plan.organization.id));
    await tx
      .delete(managementStockLocations)
      .where(eq(managementStockLocations.organizationId, plan.organization.id));
    await tx
      .delete(managementSuppliers)
      .where(eq(managementSuppliers.organizationId, plan.organization.id));
    await tx
      .delete(posProductStations)
      .where(eq(posProductStations.organizationId, plan.organization.id));
    await tx
      .delete(posProductPrices)
      .where(eq(posProductPrices.organizationId, plan.organization.id));
    await tx
      .delete(posDiningTables)
      .where(eq(posDiningTables.organizationId, plan.organization.id));
    await tx.delete(posDiningRooms).where(eq(posDiningRooms.organizationId, plan.organization.id));
    await tx.delete(posProducts).where(eq(posProducts.organizationId, plan.organization.id));
    await tx
      .delete(posCatalogCategories)
      .where(eq(posCatalogCategories.organizationId, plan.organization.id));
    await tx
      .delete(posProductionStations)
      .where(eq(posProductionStations.organizationId, plan.organization.id));
    await tx
      .delete(growthIntegrations)
      .where(eq(growthIntegrations.organizationId, plan.organization.id));
    await tx.delete(roleBindings).where(
      inArray(
        roleBindings.membershipId,
        DEMO_ROLE_NAMES.map((_, index) => demoUuid(11, index + 1)),
      ),
    );
    await tx.delete(memberships).where(eq(memberships.organizationId, plan.organization.id));
    await tx.delete(units).where(eq(units.organizationId, plan.organization.id));
    await tx.delete(organizations).where(eq(organizations.id, plan.organization.id));
    await tx.delete(identities).where(
      inArray(
        identities.id,
        DEMO_ROLE_NAMES.map((_, index) => demoUuid(10, index + 1)),
      ),
    );

    await tx.insert(identities).values(plan.identities);
    await tx.insert(organizations).values(plan.organization);
    await tx.insert(units).values(plan.units);
    await tx.insert(memberships).values(plan.memberships);
    await tx.insert(roleBindings).values(plan.roleBindings);
    await tx.insert(posCatalogCategories).values(plan.categories);
    await tx.insert(posProducts).values(plan.products);
    await tx.insert(posProductionStations).values(plan.stations);
    await tx.insert(posProductPrices).values(plan.productPrices);
    await tx.insert(posProductStations).values(plan.productStations);
    await tx.insert(posDiningRooms).values(plan.rooms);
    await tx.insert(posDiningTables).values(plan.tables);
    await tx.insert(posTabs).values(plan.tabs);
    await tx.insert(posOrders).values(plan.orders);
    await tx.insert(posOrderItems).values(plan.orderItems);
    await tx.insert(posKdsTickets).values(plan.kdsTickets);
    await tx.insert(posKdsTicketItems).values(plan.kdsTicketItems);
    await tx.insert(managementSuppliers).values(plan.suppliers);
    await tx.insert(managementStockLocations).values(plan.stockLocations);
    await tx.insert(managementInventoryItems).values(plan.inventoryItems);
    await tx.insert(managementStockBalances).values(plan.stockBalances);
    await tx.insert(managementInventoryEvents).values(plan.inventoryEvents);
    await tx.insert(managementInventoryEventLines).values(plan.inventoryEventLines);
    await tx.insert(managementInventoryMovements).values(plan.inventoryMovements);
    await tx.insert(managementAccountsPayable).values(plan.payables);
    await tx.insert(managementCashShifts).values(plan.cashShifts);
    await tx.insert(managementAccountsReceivable).values(plan.receivables);
    await tx.insert(managementReceivablePayments).values(plan.receivablePayments);
    await tx.insert(growthIntegrations).values(plan.growthIntegrations);
  });
}

async function runSeed() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const { client, db } = createDatabase(connectionString);
  try {
    await seedCommercialCatalog(db);
    if (process.env.GIROMESA_DEMO_RESET_CONFIRM) {
      assertDemoResetAllowed(connectionString, process.env.GIROMESA_DEMO_RESET_CONFIRM);
      await resetDemoTenant(db);
    }
  } finally {
    await client.end();
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) await runSeed();
