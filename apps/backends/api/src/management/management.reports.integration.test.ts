import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  identities,
  memberships,
  organizations,
  posCatalogCategories,
  posOrderItems,
  posOrders,
  posPaymentReconciliations,
  posProducts,
  posTabPayments,
  posTabs,
  roleBindings,
  units,
} from "@giromesa/db";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { MetricsService } from "../health/health.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { ManagementService } from "./management.service.js";
import { ManagementReportService } from "./management-report.service.js";

it("executes every management report family against PostgreSQL", async (context) => {
  const databaseUrl = process.env.MANAGEMENT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    context.skip("MANAGEMENT_DATABASE_URL or DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  let organizationId: string | null = null;
  let identityId: string | null = null;
  try {
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "Reports integration Ltda",
        tradeName: "Reports integration",
        document: String(Date.now()).padEnd(14, "0").slice(0, 14),
      })
      .returning({ id: organizations.id });
    assert.ok(organization);
    organizationId = organization.id;
    const [unit] = await database.db
      .insert(units)
      .values({ organizationId, name: "Reports unit", timezone: "America/Sao_Paulo" })
      .returning({ id: units.id });
    const [identity] = await database.db
      .insert(identities)
      .values({ email: `reports-${randomUUID()}@example.test`, displayName: "Reports owner" })
      .returning({ id: identities.id });
    assert.ok(unit && identity);
    identityId = identity.id;
    const [membership] = await database.db
      .insert(memberships)
      .values({ identityId, organizationId, status: "active" })
      .returning({ id: memberships.id });
    assert.ok(membership);
    await database.db.insert(roleBindings).values({ membershipId: membership.id, role: "owner" });

    const scope = new ScopeService(database);
    const management = new ManagementService(database, scope);
    const reports = new ManagementReportService(database, scope, management, new MetricsService());
    const report = await reports.reports(identityId, organizationId, unit.id, {
      from: "2026-08-01",
      to: "2026-08-17",
      comparisonMode: "previous_period",
    });

    assert.equal(report.reportFamilies.sales.closedTabs, 0);
    assert.equal(report.reportFamilies.exceptions.canceledItems, 0);
    assert.equal(report.reportFamilies.inventory.currentInventoryValueCents, 0);
    assert.equal(report.reportFamilies.purchasing.orderCount, 0);
    assert.equal(report.reportFamilies.operations.averageServiceMinutes, null);
    assert.equal(report.reportFamilies.profitability.productProfitabilityCoverage, "unavailable");
    assert.deepEqual(report.reportFamilies.inventory.countVariance, []);
    assert.deepEqual(report.reportFamilies.profitability.channels, []);
    assert.equal(report.reportFamilies.labor.workedMinutes, 0);
    assert.equal(report.reportFamilies.reconciliation.paymentDifferenceCents, 0);
    assert.equal(report.reportFamilies.forecast.method, "weekday_seasonality_v2");
    assert.equal(report.reportFamilies.forecast.available, false);
    assert.equal(report.reportFamilies.forecast.revenue.forecastCents, 0);

    const closedAt = new Date("2026-08-12T15:00:00.000Z");
    const [category] = await database.db
      .insert(posCatalogCategories)
      .values({
        organizationId,
        name: "Reports menu",
        slug: `reports-${randomUUID()}`,
      })
      .returning({ id: posCatalogCategories.id });
    assert.ok(category);
    const [product] = await database.db
      .insert(posProducts)
      .values({ organizationId, categoryId: category.id, name: "Reports plate" })
      .returning({ id: posProducts.id });
    assert.ok(product);
    const [cashTab, pixTab, pendingFeeTab] = await database.db
      .insert(posTabs)
      .values([
        {
          organizationId,
          unitId: unit.id,
          openedByIdentityId: identityId,
          label: "Cash channel",
          fulfillmentType: "dine_in",
          status: "closed",
          subtotalCents: 1_000,
          totalCents: 1_000,
          closedAt,
        },
        {
          organizationId,
          unitId: unit.id,
          openedByIdentityId: identityId,
          label: "Pix channel",
          fulfillmentType: "delivery",
          status: "closed",
          subtotalCents: 2_000,
          serviceChargeCents: 200,
          totalCents: 2_200,
          closedAt,
        },
        {
          organizationId,
          unitId: unit.id,
          openedByIdentityId: identityId,
          label: "Pending fee channel",
          fulfillmentType: "pickup",
          status: "closed",
          subtotalCents: 3_000,
          totalCents: 3_000,
          closedAt,
        },
      ])
      .returning({ id: posTabs.id });
    assert.ok(cashTab && pixTab && pendingFeeTab);
    const [cashOrder, pixOrder, pendingFeeOrder] = await database.db
      .insert(posOrders)
      .values([
        {
          organizationId,
          unitId: unit.id,
          tabId: cashTab.id,
          createdByIdentityId: identityId,
          status: "sent",
          sentAt: closedAt,
        },
        {
          organizationId,
          unitId: unit.id,
          tabId: pixTab.id,
          createdByIdentityId: identityId,
          status: "sent",
          sentAt: closedAt,
        },
        {
          organizationId,
          unitId: unit.id,
          tabId: pendingFeeTab.id,
          createdByIdentityId: identityId,
          status: "sent",
          sentAt: closedAt,
        },
      ])
      .returning({ id: posOrders.id });
    assert.ok(cashOrder && pixOrder && pendingFeeOrder);
    await database.db.insert(posOrderItems).values([
      {
        organizationId,
        unitId: unit.id,
        orderId: cashOrder.id,
        productId: product.id,
        productName: "Cash plate",
        quantity: 1,
        unitPriceCents: 1_000,
        grossCents: 1_000,
        netCents: 1_000,
        costCents: 400,
        status: "queued",
      },
      {
        organizationId,
        unitId: unit.id,
        orderId: pixOrder.id,
        productId: product.id,
        productName: "Pix plate",
        quantity: 1,
        unitPriceCents: 2_000,
        grossCents: 2_000,
        netCents: 2_000,
        costCents: 800,
        status: "queued",
      },
      {
        organizationId,
        unitId: unit.id,
        orderId: pendingFeeOrder.id,
        productId: product.id,
        productName: "Pending fee plate",
        quantity: 1,
        unitPriceCents: 3_000,
        grossCents: 3_000,
        netCents: 3_000,
        costCents: 1_200,
        status: "queued",
      },
    ]);
    const [cashPayment, pixPayment, pendingFeePayment] = await database.db
      .insert(posTabPayments)
      .values([
        {
          organizationId,
          unitId: unit.id,
          tabId: cashTab.id,
          method: "cash",
          amountCents: 1_000,
          createdByIdentityId: identityId,
        },
        {
          organizationId,
          unitId: unit.id,
          tabId: pixTab.id,
          method: "pix",
          amountCents: 2_200,
          createdByIdentityId: identityId,
        },
        {
          organizationId,
          unitId: unit.id,
          tabId: pendingFeeTab.id,
          method: "credit_card",
          amountCents: 3_000,
          createdByIdentityId: identityId,
        },
      ])
      .returning({ id: posTabPayments.id });
    assert.ok(cashPayment && pixPayment && pendingFeePayment);
    await database.db.insert(posPaymentReconciliations).values({
      organizationId,
      unitId: unit.id,
      paymentId: pixPayment.id,
      provider: "reports-test",
      providerSettlementId: `settlement-${randomUUID()}`,
      providerReference: `reference-${randomUUID()}`,
      grossCents: 2_200,
      feeCents: 264,
      netCents: 1_936,
      expectedSettlementAt: closedAt,
      settledAt: closedAt,
      status: "settled",
      source: "import",
    });
    const profitabilityReport = await reports.reports(identityId, organizationId, unit.id, {
      from: "2026-08-01",
      to: "2026-08-17",
      comparisonMode: "previous_period",
      family: "profitability",
    });
    const channels = new Map(
      profitabilityReport.reportFamilies.profitability.channels.map((channel) => [
        channel.key,
        channel,
      ]),
    );
    assert.deepEqual(channels.get("dine_in"), {
      key: "dine_in",
      label: "Salão",
      revenueCents: 1_000,
      costCents: 400,
      feeCents: 0,
      grossMarginCents: 600,
      netMarginAfterFeesCents: 600,
      costCoverage: "complete",
      feeCoverage: "complete",
    });
    assert.deepEqual(channels.get("delivery"), {
      key: "delivery",
      label: "Delivery",
      revenueCents: 2_000,
      costCents: 800,
      feeCents: 264,
      grossMarginCents: 1_200,
      netMarginAfterFeesCents: 936,
      costCoverage: "complete",
      feeCoverage: "complete",
    });
    assert.deepEqual(channels.get("pickup"), {
      key: "pickup",
      label: "Retirada",
      revenueCents: 3_000,
      costCents: 1_200,
      feeCents: null,
      grossMarginCents: 1_800,
      netMarginAfterFeesCents: null,
      costCoverage: "complete",
      feeCoverage: "partial",
    });

    const view = await reports.createView(
      identityId,
      organizationId,
      unit.id,
      `view-${randomUUID()}`,
      {
        name: "Conferência mensal",
        visibility: "unit",
        query: {
          from: "2026-08-01",
          to: "2026-08-17",
          comparisonMode: "previous_period",
          family: "reconciliation",
        },
        isDefault: true,
        sortOrder: 4,
      },
    );
    const [savedView] = (await reports.views(identityId, organizationId, unit.id)).views;
    assert.equal(savedView?.id, view.id);
    assert.equal(savedView?.isDefault, true);
    assert.equal(savedView?.sortOrder, 4);

    const artifact = await reports.createExport(
      identityId,
      organizationId,
      unit.id,
      `export-${randomUUID()}`,
      {
        from: "2026-08-01",
        to: "2026-08-17",
        comparisonMode: "previous_period",
        family: "forecast",
        format: "xlsx",
      },
    );
    const content = await reports.exportContent(identityId, organizationId, unit.id, artifact.id);
    assert.equal(content.contentEncoding, "base64");
    assert.equal(Buffer.from(content.content, "base64").subarray(0, 2).toString(), "PK");

    const pdfArtifact = await reports.createExport(
      identityId,
      organizationId,
      unit.id,
      `export-${randomUUID()}`,
      {
        from: "2026-08-01",
        to: "2026-08-17",
        comparisonMode: "previous_period",
        family: "sales",
        format: "pdf",
      },
    );
    const pdfContent = await reports.exportContent(
      identityId,
      organizationId,
      unit.id,
      pdfArtifact.id,
    );
    const pdf = Buffer.from(pdfContent.content, "base64").toString("latin1");
    assert.match(pdf, /^%PDF-1\.4/);
    assert.match(pdf, /Reports integration/);
    assert.match(pdf, /Reports unit/);
    assert.match(pdf, /Reports owner/);
    assert.match(pdf, new RegExp(pdfArtifact.id));

    const preview = await reports.previewCosts(identityId, organizationId, unit.id, {
      from: "2026-08-01",
      to: "2026-08-17",
      comparisonMode: "previous_period",
    });
    assert.equal(preview.candidateCount, 0);

    const backfill = await reports.backfillCosts(
      identityId,
      organizationId,
      unit.id,
      `backfill-${randomUUID()}`,
      {
        from: "2026-08-01",
        to: "2026-08-17",
        comparisonMode: "previous_period",
        allowEstimated: true,
      },
    );
    assert.equal(backfill.estimatedCount, 0);

    const closure = await reports.closeReconciliation(
      identityId,
      organizationId,
      unit.id,
      `closure-${randomUUID()}`,
      {
        from: "2026-08-01",
        to: "2026-08-17",
        comparisonMode: "previous_period",
        status: "closed",
        checklist: { payments: true, fiscal: true, external: true },
        note: "Fechamento conferido no teste de integraÃ§Ã£o.",
        evidence: [],
      },
    );
    assert.equal(closure.status, "closed");
    const closedReport = await reports.reports(identityId, organizationId, unit.id, {
      from: "2026-08-01",
      to: "2026-08-17",
      comparisonMode: "previous_period",
      family: "reconciliation",
    });
    assert.equal(closedReport.reportFamilies.reconciliation.closure.status, "closed");
  } finally {
    if (organizationId) {
      await database.db
        .delete(posPaymentReconciliations)
        .where(eq(posPaymentReconciliations.organizationId, organizationId));
      await database.db
        .delete(posTabPayments)
        .where(eq(posTabPayments.organizationId, organizationId));
      await database.db
        .delete(posOrderItems)
        .where(eq(posOrderItems.organizationId, organizationId));
      await database.db.delete(posOrders).where(eq(posOrders.organizationId, organizationId));
      await database.db.delete(posTabs).where(eq(posTabs.organizationId, organizationId));
      await database.db.delete(posProducts).where(eq(posProducts.organizationId, organizationId));
      await database.db
        .delete(posCatalogCategories)
        .where(eq(posCatalogCategories.organizationId, organizationId));
      await database.db.delete(organizations).where(eq(organizations.id, organizationId));
    }
    if (identityId) await database.db.delete(identities).where(eq(identities.id, identityId));
    await database.client.end();
  }
});
