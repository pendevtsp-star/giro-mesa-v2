import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  fiscalDocumentEvents,
  identities,
  memberships,
  organizations,
  roleBindings,
  units,
} from "@giromesa/db";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { FiscalSimulatorAdapter } from "./adapters/simulator.adapter.js";
import { FiscalService } from "./fiscal.service.js";

it("keeps the sale while a simulated fiscal document is pending and reconciled", async (context) => {
  const databaseUrl = process.env.FISCAL_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("FISCAL_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  try {
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "Fiscal Test Ltda",
        tradeName: "Fiscal Test",
        document: String(randomInt(10_000_000_000_000, 99_999_999_999_999)),
      })
      .returning();
    assert.ok(organization);
    const [unit] = await database.db
      .insert(units)
      .values({ organizationId: organization.id, name: "Fiscal Unit" })
      .returning();
    const [identity] = await database.db
      .insert(identities)
      .values({ email: `fiscal-${randomUUID()}@example.test`, displayName: "Fiscal Owner" })
      .returning();
    assert.ok(unit && identity);
    const [membership] = await database.db
      .insert(memberships)
      .values({ identityId: identity.id, organizationId: organization.id, status: "active" })
      .returning();
    assert.ok(membership);
    await database.db.insert(roleBindings).values({ membershipId: membership.id, role: "owner" });

    const fiscal = new FiscalService(
      database,
      new ScopeService(database),
      new FiscalSimulatorAdapter("pending_then_authorized"),
    );
    const saleReference = `sale-${randomUUID()}`;
    const issued = await fiscal.issue(
      identity.id,
      organization.id,
      unit.id,
      "fiscal-document-0001",
      {
        saleReference,
        documentType: "nfce",
        totalCents: 4_299,
        document: { naturezaOperacao: "Venda", cnpj: "12345678000190" },
      },
    );
    assert.equal(issued.status, "submitted");
    assert.equal(issued.salePreserved, true);
    assert.equal(issued.adapterHomologated, false);

    const reconciled = await fiscal.retry(identity.id, organization.id, unit.id, issued.documentId);
    assert.equal(reconciled.status, "authorized");
    assert.equal(reconciled.saleReference, saleReference);
    assert.equal(
      (
        await database.db
          .select()
          .from(fiscalDocumentEvents)
          .where(eq(fiscalDocumentEvents.documentId, issued.documentId))
      ).length,
      3,
    );
  } finally {
    await database.onModuleDestroy();
  }
});
