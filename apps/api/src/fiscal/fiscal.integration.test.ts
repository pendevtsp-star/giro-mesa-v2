import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  fiscalDocumentEvents,
  fiscalDocuments,
  identities,
  memberships,
  organizations,
  roleBindings,
  units,
} from "@giromesa/db";
import type { FiscalAdapterResult } from "@giromesa/domain";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { managementRequestHash } from "../management/management.rules.js";
import { ScopeService } from "../organizations/scope.service.js";
import { FiscalSimulatorAdapter } from "./adapters/simulator.adapter.js";
import { FiscalService } from "./fiscal.service.js";

class RacingFiscalAdapter extends FiscalSimulatorAdapter {
  private lookupCount = 0;
  private release!: () => void;
  private readonly barrier = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  override async lookup(documentReference: string): Promise<FiscalAdapterResult> {
    const call = this.lookupCount++;
    if (this.lookupCount === 2) this.release();
    await this.barrier;
    if (call === 0) return { status: "authorized", documentReference };
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { status: "rejected", documentReference, errorCode: "LATE_REJECTION" };
  }
}

async function fiscalFixture(database: DatabaseService, name: string) {
  const [organization] = await database.db
    .insert(organizations)
    .values({
      legalName: `${name} Ltda`,
      tradeName: name,
      document: String(randomInt(10_000_000_000_000, 99_999_999_999_999)),
    })
    .returning();
  assert.ok(organization);
  const [unit] = await database.db
    .insert(units)
    .values({ organizationId: organization.id, name: `${name} Unit` })
    .returning();
  const [identity] = await database.db
    .insert(identities)
    .values({ email: `fiscal-${randomUUID()}@example.test`, displayName: `${name} Owner` })
    .returning();
  assert.ok(unit && identity);
  const [membership] = await database.db
    .insert(memberships)
    .values({ identityId: identity.id, organizationId: organization.id, status: "active" })
    .returning();
  assert.ok(membership);
  await database.db.insert(roleBindings).values({ membershipId: membership.id, role: "owner" });
  return { identity, organization, unit };
}

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

it("resumes an idempotent fiscal document left pending before provider submission", async (context) => {
  const databaseUrl = process.env.FISCAL_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("FISCAL_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  try {
    const { identity, organization, unit } = await fiscalFixture(database, "Fiscal Resume");
    const adapter = new FiscalSimulatorAdapter("authorized");
    const fiscal = new FiscalService(database, new ScopeService(database), adapter);
    const input = {
      saleReference: `sale-${randomUUID()}`,
      documentType: "nfce" as const,
      totalCents: 1_500,
      document: { naturezaOperacao: "Venda" },
    };
    const idempotencyKey = "fiscal-crash-resume-0001";
    const [stranded] = await database.db
      .insert(fiscalDocuments)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        saleReference: input.saleReference,
        documentType: input.documentType,
        totalCents: input.totalCents,
        documentPayload: input.document,
        adapter: adapter.name,
        adapterHomologated: adapter.homologated,
        idempotencyKey,
        requestHash: managementRequestHash("fiscal-document", input),
        actorIdentityId: identity.id,
      })
      .returning();
    assert.ok(stranded);

    const resumed = await fiscal.issue(
      identity.id,
      organization.id,
      unit.id,
      idempotencyKey,
      input,
    );
    assert.equal(resumed.status, "authorized");
    assert.equal("idempotentReplay" in resumed && resumed.idempotentReplay, true);
  } finally {
    await database.onModuleDestroy();
  }
});

it("keeps a terminal fiscal outcome monotonic under concurrent stale lookups", async (context) => {
  const databaseUrl = process.env.FISCAL_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("FISCAL_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  try {
    const { identity, organization, unit } = await fiscalFixture(database, "Fiscal Race");
    const adapter = new RacingFiscalAdapter("pending_then_authorized");
    const fiscal = new FiscalService(database, new ScopeService(database), adapter);
    const issued = await fiscal.issue(
      identity.id,
      organization.id,
      unit.id,
      "fiscal-racing-state-0001",
      {
        saleReference: `sale-${randomUUID()}`,
        documentType: "nfce",
        totalCents: 2_500,
        document: { naturezaOperacao: "Venda" },
      },
    );
    assert.equal(issued.status, "submitted");

    const outcomes = await Promise.all([
      fiscal.retry(identity.id, organization.id, unit.id, issued.documentId),
      fiscal.retry(identity.id, organization.id, unit.id, issued.documentId),
    ]);
    assert.ok(outcomes.every((outcome) => outcome.status === "authorized"));
    const events = await database.db
      .select()
      .from(fiscalDocumentEvents)
      .where(eq(fiscalDocumentEvents.documentId, issued.documentId));
    assert.equal(events.filter((event) => event.event === "authorize").length, 1);
    assert.equal(events.filter((event) => event.event === "reject").length, 0);
  } finally {
    await database.onModuleDestroy();
  }
});
