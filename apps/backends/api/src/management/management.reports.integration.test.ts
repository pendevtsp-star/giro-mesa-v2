import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import { identities, memberships, organizations, roleBindings, units } from "@giromesa/db";
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
    assert.equal(report.reportFamilies.labor.workedMinutes, 0);
    assert.equal(report.reportFamilies.reconciliation.paymentDifferenceCents, 0);
    assert.equal(report.reportFamilies.forecast.method, "weekday_seasonality_v2");
    assert.equal(report.reportFamilies.forecast.available, false);
    assert.equal(report.reportFamilies.forecast.revenue.forecastCents, 0);

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
    if (organizationId)
      await database.db.delete(organizations).where(eq(organizations.id, organizationId));
    if (identityId) await database.db.delete(identities).where(eq(identities.id, identityId));
    await database.client.end();
  }
});
