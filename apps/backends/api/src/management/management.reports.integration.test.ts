import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import { identities, memberships, organizations, roleBindings, units } from "@giromesa/db";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { ManagementService } from "./management.service.js";

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

    const management = new ManagementService(database, new ScopeService(database));
    const report = await management.reports(identityId, organizationId, unit.id, {
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
  } finally {
    if (organizationId)
      await database.db.delete(organizations).where(eq(organizations.id, organizationId));
    if (identityId) await database.db.delete(identities).where(eq(identities.id, identityId));
    await database.client.end();
  }
});
