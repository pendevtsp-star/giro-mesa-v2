import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  auditEvents,
  identities,
  managementPurchaseOrders,
  managementRecipeVersions,
  memberships,
  organizations,
  posCatalogCategories,
  posProducts,
  roleBindings,
  units,
} from "@giromesa/db";
import { and, eq, inArray } from "drizzle-orm";
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

function nfeFixture(input: {
  documentNumber: number;
  issuerDocument: string;
  recipientDocument: string;
  totalCents: number;
}) {
  const issuedAt = "2026-08-17";
  const series = "1";
  const base = `35${issuedAt.slice(2, 4)}${issuedAt.slice(5, 7)}${input.issuerDocument}55${series.padStart(3, "0")}${String(input.documentNumber).padStart(9, "0")}112345678`;
  const sum = [...base]
    .reverse()
    .reduce((total, digit, index) => total + Number(digit) * ((index % 8) + 2), 0);
  const candidate = 11 - (sum % 11);
  const accessKey = `${base}${candidate >= 10 ? 0 : candidate}`;
  const total = (input.totalCents / 100).toFixed(2);
  return {
    accessKey,
    issuedAt,
    series,
    model: "55" as const,
    taxTotalCents: 0,
    xmlContent: `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe${accessKey}"><ide><mod>55</mod><serie>${series}</serie><nNF>${input.documentNumber}</nNF><dhEmi>${issuedAt}T10:00:00-03:00</dhEmi></ide><emit><CNPJ>${input.issuerDocument}</CNPJ><xNome>Fornecedor</xNome></emit><dest><CNPJ>${input.recipientDocument}</CNPJ></dest><det nItem="1"><prod><cProd>ITEM</cProd><cEAN>SEM GTIN</cEAN><xProd>Item</xProd><uCom>UN</uCom><qCom>2.000</qCom><vUnCom>${(input.totalCents / 200).toFixed(2)}</vUnCom><vProd>${total}</vProd></prod></det><total><ICMSTot><vTotTrib>0.00</vTotTrib><vNF>${total}</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`,
  };
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
    const [unitA, unitB, unitC] = await database.db
      .insert(units)
      .values([
        { organizationId: organizationA.id, name: "Management Unit A" },
        { organizationId: organizationB.id, name: "Management Unit B" },
        { organizationId: organizationA.id, name: "Management Unit C" },
      ])
      .returning();
    assert.ok(unitA && unitB && unitC);
    const [identityA, identityB, identityC] = await database.db
      .insert(identities)
      .values([
        { email: `management-a-${randomUUID()}@example.test`, displayName: "Owner A" },
        { email: `management-b-${randomUUID()}@example.test`, displayName: "Owner B" },
        { email: `management-c-${randomUUID()}@example.test`, displayName: "Manager C" },
      ])
      .returning();
    assert.ok(identityA && identityB && identityC);
    const [membershipA, membershipB, membershipC] = await database.db
      .insert(memberships)
      .values([
        { identityId: identityA.id, organizationId: organizationA.id, status: "active" },
        { identityId: identityB.id, organizationId: organizationB.id, status: "active" },
        { identityId: identityC.id, organizationId: organizationA.id, status: "active" },
      ])
      .returning();
    assert.ok(membershipA && membershipB && membershipC);
    await database.db.insert(roleBindings).values([
      { membershipId: membershipA.id, role: "owner" },
      { membershipId: membershipB.id, role: "owner" },
      { membershipId: membershipC.id, role: "manager", unitId: unitC.id },
    ]);
    const peopleDashboard = await management.peopleDashboard(
      identityA.id,
      organizationA.id,
      unitA.id,
    );
    assert.deepEqual(
      peopleDashboard.accounts.map((account) => account.id),
      [identityA.id],
    );
    await assert.rejects(
      () =>
        management.timeTrackingReport(identityC.id, organizationA.id, unitC.id, {
          from: "2026-08-01",
          to: "2026-08-16",
          comparisonMode: "previous_period",
        }),
      hasCode("TIME_TRACKING_MANAGER_VIEW_DISABLED"),
    );
    const emptyReport = await management.reports(identityA.id, organizationA.id, unitA.id, {
      from: "2026-08-01",
      to: "2026-08-16",
      comparisonMode: "previous_period",
    });
    assert.equal(emptyReport.timezone, unitA.timezone);
    assert.equal(emptyReport.comparison.revenueCents, 0);
    assert.equal(emptyReport.dailySeries.length, 16);
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

    const supplierB = await management.createSupplier(
      identityB.id,
      organizationB.id,
      unitB.id,
      "supplier-b-001",
      { name: "Supplier B" },
    );
    assert.ok(supplierB);
    await assert.rejects(
      () => management.listSuppliers(identityA.id, organizationB.id, unitB.id),
      hasCode("UNIT_ACCESS_DENIED"),
    );

    const location = await management.createStockLocation(
      identityA.id,
      organizationA.id,
      unitA.id,
      "location-main-001",
      { name: "Main stock", code: "main" },
    );
    const item = await management.createInventoryItem(
      identityA.id,
      organizationA.id,
      unitA.id,
      "inventory-rice-001",
      {
        name: "Rice",
        kind: "ingredient",
        unit: "kg",
        purchaseToStockFactor: "1",
        minimumQuantity: "2",
        reorderQuantity: "0",
        leadTimeDays: 0,
        allowNegative: false,
      },
    );
    const supplier = await management.createSupplier(
      identityA.id,
      organizationA.id,
      unitA.id,
      "supplier-a-001",
      { name: "Supplier A" },
    );
    assert.ok(location && item && supplier);
    const supplierSearch = randomUUID();
    await Promise.all(
      ["A", "B", "C"].map((suffix) =>
        management.createSupplier(
          identityA.id,
          organizationA.id,
          unitA.id,
          `supplier-pagination-${suffix}-${supplierSearch}`,
          { name: `${supplierSearch} ${suffix}` },
        ),
      ),
    );
    const [supplierPage1, supplierPage2] = await Promise.all([
      management.listSuppliers(identityA.id, organizationA.id, unitA.id, {
        search: supplierSearch,
        page: 1,
        pageSize: 1,
      }),
      management.listSuppliers(identityA.id, organizationA.id, unitA.id, {
        search: supplierSearch,
        page: 2,
        pageSize: 1,
      }),
    ]);
    assert.equal(supplierPage1.pagination.total, 3);
    assert.equal(supplierPage1.pagination.pageCount, 3);
    assert.notEqual(supplierPage1.items[0]?.id, supplierPage2.items[0]?.id);
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
    const secondPurchase = await management.createPurchaseOrder(
      identityA.id,
      organizationA.id,
      unitA.id,
      "purchase-order-0002",
      {
        supplierId: supplier.id,
        items: [{ inventoryItemId: item.id, quantity: "2", unitCostCents: 250 }],
      },
    );
    const tiedCreatedAt = new Date("2026-08-17T12:00:00.000Z");
    await database.db
      .update(managementPurchaseOrders)
      .set({ createdAt: tiedCreatedAt })
      .where(
        inArray(managementPurchaseOrders.id, [
          purchase.purchaseOrderId,
          secondPurchase.purchaseOrderId,
        ]),
      );
    const [firstPage, secondPage] = await Promise.all([
      management.listPurchases(identityA.id, organizationA.id, unitA.id, {
        status: "draft",
        page: 1,
        pageSize: 1,
      }),
      management.listPurchases(identityA.id, organizationA.id, unitA.id, {
        status: "draft",
        page: 2,
        pageSize: 1,
      }),
    ]);
    const expectedStableOrder = [purchase.purchaseOrderId, secondPurchase.purchaseOrderId]
      .sort()
      .reverse();
    assert.deepEqual([firstPage.orders[0]?.id, secondPage.orders[0]?.id], expectedStableOrder);
    await management.approvePurchaseOrder(
      identityA.id,
      organizationA.id,
      unitA.id,
      purchase.purchaseOrderId,
      "approve-order-0001",
      { version: 1 },
    );
    await assert.rejects(
      () =>
        management.approvePurchaseOrder(
          identityA.id,
          organizationA.id,
          unitA.id,
          purchase.purchaseOrderId,
          "approve-order-stale-0001",
          { version: 1 },
        ),
      hasCode("PURCHASE_ORDER_VERSION_CONFLICT"),
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
      lines: [
        {
          purchaseOrderItemId: purchaseItem.id,
          locationId: location.id,
          quantity: "10",
          batchCode: "LOT-0001",
        },
      ],
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
    assert.equal(inventory.balances[0]?.quantity, "10.000");
    assert.equal(inventory.balances[0]?.averageCostCents, 250);
    const receiptLine = (
      await management.listPurchases(identityA.id, organizationA.id, unitA.id)
    ).receiptLines.find((line) => line.receiptId === receipt.receiptId);
    assert.ok(receiptLine?.lotId);
    await management.recordInventoryEvent(
      identityA.id,
      organizationA.id,
      unitA.id,
      "consume-received-lot-0001",
      {
        type: "loss",
        reason: "Consumo de validação do lote",
        lines: [
          {
            inventoryItemId: item.id,
            locationId: location.id,
            lotId: receiptLine.lotId,
            quantity: "1",
          },
        ],
      },
    );
    await assert.rejects(
      () =>
        management.reversePurchaseReceipt(
          identityA.id,
          organizationA.id,
          unitA.id,
          receipt.receiptId,
          "reverse-consumed-receipt-0001",
          { reason: "Recebimento lançado incorretamente", version: 1 },
        ),
      hasCode("PURCHASE_RECEIPT_LOT_CONSUMED"),
    );
    const invoice = await management.createSupplierInvoice(
      identityA.id,
      organizationA.id,
      unitA.id,
      purchase.purchaseOrderId,
      "invoice-order-0001",
      {
        documentNumber: "NF-0001",
        issuedAt: "2026-08-09",
        competenceDate: "2026-08-09",
        dueDate: "2026-08-20",
        totalCents: 2_500,
        toleranceCents: 0,
        confirmIfMatched: true,
        lines: [{ purchaseOrderItemId: purchaseItem.id, quantity: "10", unitCostCents: 250 }],
      },
    );
    assert.ok(invoice.payableId);
    await assert.rejects(
      () =>
        management.reversePurchaseReceipt(
          identityA.id,
          organizationA.id,
          unitA.id,
          receipt.receiptId,
          "reverse-receipt-active-invoice-001",
          { reason: "Recebimento vinculado à fatura ativa", version: 1 },
        ),
      hasCode("PURCHASE_RECEIPT_HAS_ACTIVE_INVOICE"),
    );
    const finance = await management.financeDashboard(identityA.id, organizationA.id, unitA.id);
    assert.equal(finance.payables.length, 1);
    assert.equal(finance.payables[0]?.id, invoice.payableId);
    assert.equal(finance.payables[0]?.amountCents, 2_500);

    const payment = await management.payPayable(
      identityA.id,
      organizationA.id,
      unitA.id,
      invoice.payableId,
      "pay-receipt-0001",
      { amountCents: 2_500, method: "pix", reference: "bank-e2e" },
    );
    const replayedPayment = await management.payPayable(
      identityA.id,
      organizationA.id,
      unitA.id,
      invoice.payableId,
      "pay-receipt-0001",
      { amountCents: 2_500, method: "pix", reference: "bank-e2e" },
    );
    assert.equal(payment.status, "paid");
    assert.equal(replayedPayment.idempotentReplay, true);
    assert.equal(replayedPayment.paymentId, payment.paymentId);
    assert.ok(invoice.version);
    await assert.rejects(
      () =>
        management.cancelSupplierInvoice(
          identityA.id,
          organizationA.id,
          unitA.id,
          invoice.invoiceId,
          "cancel-paid-invoice-0001",
          { reason: "Cancelamento fiscal solicitado", version: invoice.version },
        ),
      hasCode("SUPPLIER_INVOICE_PAYABLE_PAID"),
    );

    await management.approvePurchaseOrder(
      identityA.id,
      organizationA.id,
      unitA.id,
      secondPurchase.purchaseOrderId,
      "approve-order-0002",
      { version: 1 },
    );
    const secondPurchaseItem = (
      await management.listPurchases(identityA.id, organizationA.id, unitA.id)
    ).items.find((candidate) => candidate.purchaseOrderId === secondPurchase.purchaseOrderId);
    assert.ok(secondPurchaseItem);
    await management.receivePurchaseOrder(
      identityA.id,
      organizationA.id,
      unitA.id,
      secondPurchase.purchaseOrderId,
      "receive-order-0002",
      {
        lines: [
          {
            purchaseOrderItemId: secondPurchaseItem.id,
            locationId: location.id,
            quantity: "2",
          },
        ],
      },
    );
    const issuerDocument = "11222333000144";
    const nfeForUnit = nfeFixture({
      documentNumber: 2001,
      issuerDocument,
      recipientDocument: organizationA.document,
      totalCents: 500,
    });
    await assert.rejects(
      () =>
        management.createSupplierInvoice(
          identityA.id,
          organizationA.id,
          unitA.id,
          secondPurchase.purchaseOrderId,
          "invoice-nfe-missing-supplier-document",
          {
            documentNumber: "2001",
            competenceDate: "2026-08-17",
            dueDate: "2026-08-20",
            totalCents: 500,
            toleranceCents: 0,
            confirmIfMatched: false,
            lines: [
              { purchaseOrderItemId: secondPurchaseItem.id, quantity: "2", unitCostCents: 250 },
            ],
            ...nfeForUnit,
          },
        ),
      hasCode("SUPPLIER_DOCUMENT_REQUIRED_FOR_NFE"),
    );
    await management.updateSupplier(
      identityA.id,
      organizationA.id,
      unitA.id,
      supplier.id,
      "supplier-add-document-001",
      { document: issuerDocument, version: 1 },
    );
    const nfeForAnotherTenant = nfeFixture({
      documentNumber: 2002,
      issuerDocument,
      recipientDocument: organizationB.document,
      totalCents: 500,
    });
    await assert.rejects(
      () =>
        management.createSupplierInvoice(
          identityA.id,
          organizationA.id,
          unitA.id,
          secondPurchase.purchaseOrderId,
          "invoice-nfe-other-recipient",
          {
            documentNumber: "2002",
            competenceDate: "2026-08-17",
            dueDate: "2026-08-20",
            totalCents: 500,
            toleranceCents: 0,
            confirmIfMatched: false,
            lines: [
              { purchaseOrderItemId: secondPurchaseItem.id, quantity: "2", unitCostCents: 250 },
            ],
            ...nfeForAnotherTenant,
          },
        ),
      hasCode("NFE_RECIPIENT_MISMATCH"),
    );
    const secondInvoice = await management.createSupplierInvoice(
      identityA.id,
      organizationA.id,
      unitA.id,
      secondPurchase.purchaseOrderId,
      "invoice-order-0002",
      {
        documentNumber: "NF-0002",
        issuedAt: "2026-08-17",
        competenceDate: "2026-08-17",
        dueDate: "2026-08-20",
        totalCents: 500,
        toleranceCents: 0,
        confirmIfMatched: false,
        lines: [{ purchaseOrderItemId: secondPurchaseItem.id, quantity: "2", unitCostCents: 250 }],
      },
    );
    const auditCount = async () =>
      (
        await database.db
          .select({ id: auditEvents.id })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.organizationId, organizationA.id),
              eq(auditEvents.unitId, unitA.id),
              eq(auditEvents.action, "management.purchase-invoice.reconciled"),
              eq(auditEvents.entityId, secondInvoice.invoiceId),
            ),
          )
      ).length;
    const auditsBefore = await auditCount();
    const concurrentReconciliations = await Promise.allSettled([
      management.reconcileSupplierInvoice(
        identityA.id,
        organizationA.id,
        unitA.id,
        secondInvoice.invoiceId,
        "reconcile-order-0002-a",
        { toleranceCents: 0, version: 1 },
      ),
      management.reconcileSupplierInvoice(
        identityA.id,
        organizationA.id,
        unitA.id,
        secondInvoice.invoiceId,
        "reconcile-order-0002-b",
        { toleranceCents: 0, version: 1 },
      ),
    ]);
    assert.equal(
      concurrentReconciliations.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const rejectedReconciliation = concurrentReconciliations.find(
      (result) => result.status === "rejected",
    );
    assert.ok(rejectedReconciliation && rejectedReconciliation.status === "rejected");
    assert.equal(hasCode("SUPPLIER_INVOICE_VERSION_CONFLICT")(rejectedReconciliation.reason), true);
    assert.equal(await auditCount(), auditsBefore + 1);

    const locationC = await management.createStockLocation(
      identityA.id,
      organizationA.id,
      unitC.id,
      "location-unit-c",
      { name: "Unit C stock", code: "unit-c" },
    );
    const itemC = await management.createInventoryItem(
      identityA.id,
      organizationA.id,
      unitC.id,
      "inventory-unit-c",
      {
        name: "Unit C item",
        kind: "ingredient",
        unit: "un",
        purchaseToStockFactor: "1",
        minimumQuantity: "0",
        reorderQuantity: "0",
        leadTimeDays: 0,
        allowNegative: false,
      },
    );
    const supplierC = await management.createSupplier(
      identityA.id,
      organizationA.id,
      unitC.id,
      "supplier-unit-c",
      { name: "Supplier C", document: issuerDocument },
    );
    const nfePurchaseA = await management.createPurchaseOrder(
      identityA.id,
      organizationA.id,
      unitA.id,
      "purchase-nfe-global-a",
      {
        supplierId: supplier.id,
        items: [{ inventoryItemId: item.id, quantity: "2", unitCostCents: 250 }],
      },
    );
    const nfePurchaseC = await management.createPurchaseOrder(
      identityA.id,
      organizationA.id,
      unitC.id,
      "purchase-nfe-global-c",
      {
        supplierId: supplierC.id,
        items: [{ inventoryItemId: itemC.id, quantity: "2", unitCostCents: 250 }],
      },
    );
    await Promise.all([
      management.approvePurchaseOrder(
        identityA.id,
        organizationA.id,
        unitA.id,
        nfePurchaseA.purchaseOrderId,
        "approve-nfe-global-a",
        { version: 1 },
      ),
      management.approvePurchaseOrder(
        identityA.id,
        organizationA.id,
        unitC.id,
        nfePurchaseC.purchaseOrderId,
        "approve-nfe-global-c",
        { version: 1 },
      ),
    ]);
    const [nfeItemA, nfeItemC] = await Promise.all([
      management
        .listPurchases(identityA.id, organizationA.id, unitA.id)
        .then((result) =>
          result.items.find(
            (candidate) => candidate.purchaseOrderId === nfePurchaseA.purchaseOrderId,
          ),
        ),
      management
        .listPurchases(identityA.id, organizationA.id, unitC.id)
        .then((result) =>
          result.items.find(
            (candidate) => candidate.purchaseOrderId === nfePurchaseC.purchaseOrderId,
          ),
        ),
    ]);
    assert.ok(nfeItemA && nfeItemC);
    await Promise.all([
      management.receivePurchaseOrder(
        identityA.id,
        organizationA.id,
        unitA.id,
        nfePurchaseA.purchaseOrderId,
        "receive-nfe-global-a",
        { lines: [{ purchaseOrderItemId: nfeItemA.id, locationId: location.id, quantity: "2" }] },
      ),
      management.receivePurchaseOrder(
        identityA.id,
        organizationA.id,
        unitC.id,
        nfePurchaseC.purchaseOrderId,
        "receive-nfe-global-c",
        { lines: [{ purchaseOrderItemId: nfeItemC.id, locationId: locationC.id, quantity: "2" }] },
      ),
    ]);
    const duplicateNfe = await Promise.allSettled([
      management.createSupplierInvoice(
        identityA.id,
        organizationA.id,
        unitA.id,
        nfePurchaseA.purchaseOrderId,
        "invoice-nfe-global-a",
        {
          documentNumber: "2001",
          competenceDate: "2026-08-17",
          dueDate: "2026-08-20",
          totalCents: 500,
          toleranceCents: 0,
          confirmIfMatched: false,
          lines: [{ purchaseOrderItemId: nfeItemA.id, quantity: "2", unitCostCents: 250 }],
          ...nfeForUnit,
        },
      ),
      management.createSupplierInvoice(
        identityA.id,
        organizationA.id,
        unitC.id,
        nfePurchaseC.purchaseOrderId,
        "invoice-nfe-global-c",
        {
          documentNumber: "2001",
          competenceDate: "2026-08-17",
          dueDate: "2026-08-20",
          totalCents: 500,
          toleranceCents: 0,
          confirmIfMatched: false,
          lines: [{ purchaseOrderItemId: nfeItemC.id, quantity: "2", unitCostCents: 250 }],
          ...nfeForUnit,
        },
      ),
    ]);
    assert.equal(duplicateNfe.filter((result) => result.status === "fulfilled").length, 1);
    const duplicateNfeRejection = duplicateNfe.find((result) => result.status === "rejected");
    assert.ok(duplicateNfeRejection && duplicateNfeRejection.status === "rejected");
    assert.equal(hasCode("SUPPLIER_INVOICE_ALREADY_EXISTS")(duplicateNfeRejection.reason), true);
  } finally {
    await database.onModuleDestroy();
  }
});
