import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  identities,
  managementRecipeVersions,
  memberships,
  organizations,
  posCatalogCategories,
  posProducts,
  roleBindings,
  units,
} from "@giromesa/db";
import { and, eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { ManagementService } from "./management.service.js";

function hasCode(expected: string) {
  return (error: unknown) => {
    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    return (
      typeof response === "object" &&
      response !== null &&
      (response as { code?: string }).code === expected
    );
  };
}

function document() {
  return String(randomInt(10_000_000_000_000, 99_999_999_999_999));
}

it("persists an atomic tenant-isolated purchase, stock and payable flow", async (context) => {
  const databaseUrl = process.env.MANAGEMENT_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("MANAGEMENT_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  try {
    const scope = new ScopeService(database);
    const management = new ManagementService(database, scope);
    const [organizationA, organizationB] = await database.db
      .insert(organizations)
      .values([
        { legalName: "Management A Ltda", tradeName: "Management A", document: document() },
        { legalName: "Management B Ltda", tradeName: "Management B", document: document() },
      ])
      .returning();
    assert.ok(organizationA && organizationB);
    const [unitA, unitB] = await database.db
      .insert(units)
      .values([
        { organizationId: organizationA.id, name: "Management Unit A" },
        { organizationId: organizationB.id, name: "Management Unit B" },
      ])
      .returning();
    assert.ok(unitA && unitB);
    const [identityA, identityB] = await database.db
      .insert(identities)
      .values([
        { email: `management-a-${randomUUID()}@example.test`, displayName: "Owner A" },
        { email: `management-b-${randomUUID()}@example.test`, displayName: "Owner B" },
      ])
      .returning();
    assert.ok(identityA && identityB);
    const [membershipA, membershipB] = await database.db
      .insert(memberships)
      .values([
        { identityId: identityA.id, organizationId: organizationA.id, status: "active" },
        { identityId: identityB.id, organizationId: organizationB.id, status: "active" },
      ])
      .returning();
    assert.ok(membershipA && membershipB);
    await database.db.insert(roleBindings).values([
      { membershipId: membershipA.id, role: "owner" },
      { membershipId: membershipB.id, role: "owner" },
    ]);
    const [category] = await database.db
      .insert(posCatalogCategories)
      .values({
        organizationId: organizationA.id,
        name: "Meals",
        slug: `management-${randomUUID()}`,
      })
      .returning();
    assert.ok(category);
    const [product] = await database.db
      .insert(posProducts)
      .values({ organizationId: organizationA.id, categoryId: category.id, name: "Lunch" })
      .returning();
    assert.ok(product);

    const supplierB = await management.createSupplier(identityB.id, organizationB.id, unitB.id, {
      name: "Supplier B",
    });
    assert.ok(supplierB);
    await assert.rejects(
      () => management.listSuppliers(identityA.id, organizationB.id, unitB.id),
      hasCode("UNIT_ACCESS_DENIED"),
    );

    const location = await management.createStockLocation(
      identityA.id,
      organizationA.id,
      unitA.id,
      { name: "Main stock", code: "main" },
    );
    const item = await management.createInventoryItem(identityA.id, organizationA.id, unitA.id, {
      name: "Rice",
      unit: "kg",
      minimumQuantity: "2",
      allowNegative: false,
    });
    const supplier = await management.createSupplier(identityA.id, organizationA.id, unitA.id, {
      name: "Supplier A",
    });
    assert.ok(location && item && supplier);
    const recipeInput = {
      productId: product.id,
      components: [
        {
          inventoryItemId: item.id,
          locationId: location.id,
          quantityMilli: 250,
          lossBasisPoints: 1_000,
        },
      ],
    };
    const recipe = await management.configureRecipe(
      identityA.id,
      organizationA.id,
      unitA.id,
      "recipe-version-0001",
      recipeInput,
    );
    const replayedRecipe = await management.configureRecipe(
      identityA.id,
      organizationA.id,
      unitA.id,
      "recipe-version-0001",
      recipeInput,
    );
    assert.equal(recipe.version, 1);
    assert.equal(replayedRecipe.idempotentReplay, true);
    const recipeComponent = recipeInput.components[0];
    assert.ok(recipeComponent);
    await management.configureRecipe(
      identityA.id,
      organizationA.id,
      unitA.id,
      "recipe-version-0002",
      {
        ...recipeInput,
        components: [{ ...recipeComponent, quantityMilli: 300 }],
      },
    );
    const recipeHistory = await database.db
      .select()
      .from(managementRecipeVersions)
      .where(
        and(
          eq(managementRecipeVersions.organizationId, organizationA.id),
          eq(managementRecipeVersions.unitId, unitA.id),
          eq(managementRecipeVersions.productId, product.id),
        ),
      );
    assert.equal(recipeHistory.length, 2);
    assert.equal(recipeHistory.filter((version) => version.validUntil === null).length, 1);
    await assert.rejects(
      () =>
        management.configureRecipe(
          identityB.id,
          organizationA.id,
          unitA.id,
          "recipe-cross-tenant",
          recipeInput,
        ),
      hasCode("UNIT_ACCESS_DENIED"),
    );
    await assert.rejects(
      () =>
        management.createPurchaseOrder(
          identityA.id,
          organizationA.id,
          unitA.id,
          "cross-tenant-supplier",
          {
            supplierId: supplierB.id,
            items: [{ inventoryItemId: item.id, quantity: "10", unitCostCents: 250 }],
          },
        ),
      hasCode("SUPPLIER_NOT_FOUND"),
    );

    const purchase = await management.createPurchaseOrder(
      identityA.id,
      organizationA.id,
      unitA.id,
      "purchase-order-0001",
      {
        supplierId: supplier.id,
        items: [{ inventoryItemId: item.id, quantity: "10", unitCostCents: 250 }],
      },
    );
    const replayedPurchase = await management.createPurchaseOrder(
      identityA.id,
      organizationA.id,
      unitA.id,
      "purchase-order-0001",
      {
        supplierId: supplier.id,
        items: [{ inventoryItemId: item.id, quantity: "10", unitCostCents: 250 }],
      },
    );
    assert.equal(replayedPurchase.idempotentReplay, true);
    assert.equal(replayedPurchase.purchaseOrderId, purchase.purchaseOrderId);
    await assert.rejects(
      () =>
        management.createPurchaseOrder(
          identityA.id,
          organizationA.id,
          unitA.id,
          "purchase-order-0001",
          {
            supplierId: supplier.id,
            items: [{ inventoryItemId: item.id, quantity: "9", unitCostCents: 250 }],
          },
        ),
      hasCode("IDEMPOTENCY_PAYLOAD_MISMATCH"),
    );
    await management.approvePurchaseOrder(
      identityA.id,
      organizationA.id,
      unitA.id,
      purchase.purchaseOrderId,
      "approve-order-0001",
    );
    const purchases = await management.listPurchases(identityA.id, organizationA.id, unitA.id);
    const purchaseItem = purchases.items.find(
      (candidate) => candidate.purchaseOrderId === purchase.purchaseOrderId,
    );
    assert.ok(purchaseItem);

    await assert.rejects(
      () =>
        management.receivePurchaseOrder(
          identityA.id,
          organizationA.id,
          unitA.id,
          purchase.purchaseOrderId,
          "receive-too-much-0001",
          {
            competenceDate: "2026-08-09",
            dueDate: "2026-08-20",
            lines: [
              { purchaseOrderItemId: purchaseItem.id, locationId: location.id, quantity: "11" },
            ],
          },
        ),
      hasCode("RECEIPT_EXCEEDS_ORDER"),
    );
    assert.equal(
      (await management.listPurchases(identityA.id, organizationA.id, unitA.id)).receipts.length,
      0,
    );
    assert.equal(
      (await management.financeDashboard(identityA.id, organizationA.id, unitA.id)).payables.length,
      0,
    );
    assert.equal(
      (await management.inventoryDashboard(identityA.id, organizationA.id, unitA.id)).balances
        .length,
      0,
    );

    const receiptInput = {
      competenceDate: "2026-08-09",
      dueDate: "2026-08-20",
      lines: [{ purchaseOrderItemId: purchaseItem.id, locationId: location.id, quantity: "10" }],
    };
    const receipt = await management.receivePurchaseOrder(
      identityA.id,
      organizationA.id,
      unitA.id,
      purchase.purchaseOrderId,
      "receive-order-0001",
      receiptInput,
    );
    const replayedReceipt = await management.receivePurchaseOrder(
      identityA.id,
      organizationA.id,
      unitA.id,
      purchase.purchaseOrderId,
      "receive-order-0001",
      receiptInput,
    );
    assert.equal(replayedReceipt.idempotentReplay, true);
    assert.equal(replayedReceipt.receiptId, receipt.receiptId);
    assert.equal(receipt.totalCents, 2_500);
    assert.equal(receipt.purchaseOrderStatus, "received");

    const inventory = await management.inventoryDashboard(identityA.id, organizationA.id, unitA.id);
    assert.equal(inventory.balances.length, 1);
    assert.equal(inventory.balances[0]?.quantity, "10.000000");
    assert.equal(inventory.balances[0]?.averageCostCents, 250);
    const finance = await management.financeDashboard(identityA.id, organizationA.id, unitA.id);
    assert.equal(finance.payables.length, 1);
    assert.equal(finance.payables[0]?.id, receipt.payableId);
    assert.equal(finance.payables[0]?.amountCents, 2_500);

    const payment = await management.payPayable(
      identityA.id,
      organizationA.id,
      unitA.id,
      receipt.payableId,
      "pay-receipt-0001",
      { amountCents: 2_500, method: "pix", reference: "bank-e2e" },
    );
    const replayedPayment = await management.payPayable(
      identityA.id,
      organizationA.id,
      unitA.id,
      receipt.payableId,
      "pay-receipt-0001",
      { amountCents: 2_500, method: "pix", reference: "bank-e2e" },
    );
    assert.equal(payment.status, "paid");
    assert.equal(replayedPayment.idempotentReplay, true);
    assert.equal(replayedPayment.paymentId, payment.paymentId);
  } finally {
    await database.onModuleDestroy();
  }
});
