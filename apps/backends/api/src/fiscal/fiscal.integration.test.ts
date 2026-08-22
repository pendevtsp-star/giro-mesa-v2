import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import {
  auditEvents,
  fiscalDocumentArtifacts,
  fiscalDocuments,
  identities,
  memberships,
  organizations,
  outboxEvents,
  roleBindings,
  units,
  writeFiscalArtifact,
} from "@giromesa/db";
import { and, eq, inArray } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { FiscalService } from "./fiscal.service.js";
import { FocusNfeClient } from "./focus-nfe.client.js";

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

it("blocks rejected documents and closes a fiscal period exactly once", async (context) => {
  const databaseUrl = process.env.FISCAL_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("FISCAL_DATABASE_URL not configured");
    return;
  }
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousMediaRoot = process.env.MEDIA_ROOT;
  const mediaRoot = await mkdtemp(join(tmpdir(), "giromesa-fiscal-integration-"));
  process.env.DATABASE_URL = databaseUrl;
  process.env.MEDIA_ROOT = mediaRoot;
  const database = new DatabaseService();
  let organizationId: string | undefined;
  const identityIds: string[] = [];
  try {
    const scope = new ScopeService(database);
    const fiscal = new FiscalService(database, scope, new FocusNfeClient());
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "Fiscal Test Ltda",
        tradeName: "Fiscal Test",
        document: String(randomInt(10_000_000_000_000, 99_999_999_999_999)),
      })
      .returning();
    assert.ok(organization);
    organizationId = organization.id;
    const [unit] = await database.db
      .insert(units)
      .values({
        organizationId: organization.id,
        name: "Fiscal Unit",
        timezone: "America/Sao_Paulo",
      })
      .returning();
    assert.ok(unit);
    const [owner, outsider] = await database.db
      .insert(identities)
      .values([
        { email: `fiscal-owner-${randomUUID()}@example.test`, displayName: "Fiscal Owner" },
        { email: `fiscal-outsider-${randomUUID()}@example.test`, displayName: "Outsider" },
      ])
      .returning();
    assert.ok(owner && outsider);
    identityIds.push(owner.id, outsider.id);
    const [membership] = await database.db
      .insert(memberships)
      .values({ identityId: owner.id, organizationId: organization.id, status: "active" })
      .returning();
    assert.ok(membership);
    await database.db.insert(roleBindings).values({ membershipId: membership.id, role: "owner" });
    await assert.rejects(
      () => fiscal.dashboard(outsider.id, organizationId as string, unit.id),
      hasCode("UNIT_ACCESS_DENIED"),
    );

    const [document] = await database.db
      .insert(fiscalDocuments)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        model: "nfce",
        environment: "homologation",
        status: "rejected",
        idempotencyKey: `fiscal-${randomUUID()}`,
        totalCents: 5_000,
        snapshot: { source: "integration-test" },
        issuedAt: new Date("2026-08-15T03:30:00.000Z"),
      })
      .returning();
    assert.ok(document);
    await assert.rejects(
      () => fiscal.closePeriod(owner.id, organizationId as string, unit.id, "2026-08"),
      hasCode("FISCAL_PERIOD_HAS_PENDING_DOCUMENTS"),
    );
    await database.db
      .update(fiscalDocuments)
      .set({ status: "authorized", authorizedAt: new Date() })
      .where(eq(fiscalDocuments.id, document.id));
    const xml = await writeFiscalArtifact({
      root: mediaRoot,
      organizationId: organization.id,
      unitId: unit.id,
      namespace: "documents",
      entityId: document.id,
      name: "authorization_xml",
      extension: "xml",
      content: Buffer.from("<nfeProc><protNFe /></nfeProc>"),
    });
    await database.db.insert(fiscalDocumentArtifacts).values({
      organizationId: organization.id,
      unitId: unit.id,
      documentId: document.id,
      kind: "authorization_xml",
      storageKey: xml.storageKey,
      sha256: xml.sha256,
      bytes: xml.bytes,
      contentType: "application/xml",
    });

    const closed = await fiscal.closePeriod(owner.id, organizationId, unit.id, "2026-08");
    const replay = await fiscal.closePeriod(owner.id, organizationId, unit.id, "2026-08");
    assert.equal(closed.replayed, false);
    assert.equal(replay.replayed, true);
    const packagePayload = closed.package?.payload as
      | { totals?: { totalCents?: number } }
      | null
      | undefined;
    assert.equal(packagePayload?.totals?.totalCents, 5_000);
    const periodId = closed.period?.id;
    assert.ok(periodId);
    const download = await fiscal.accountantPackageContent(
      owner.id,
      organizationId,
      unit.id,
      "2026-08",
    );
    assert.equal(download.mimeType, "application/zip");
    assert.ok(Buffer.from(download.content, "base64").includes(Buffer.from("manifesto.json")));
    const available = await fiscal.accountantPackage(owner.id, organizationId, unit.id, "2026-08");
    assert.equal(available.status, "available");
    const [auditRows, outboxRows] = await Promise.all([
      database.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.organizationId, organizationId),
            eq(auditEvents.action, "fiscal.period.closed"),
            eq(auditEvents.entityId, periodId),
          ),
        ),
      database.db
        .select({ id: outboxEvents.id })
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.topic, "fiscal.period.closed"),
            eq(outboxEvents.aggregateId, periodId),
          ),
        ),
    ]);
    assert.equal(auditRows.length, 1);
    assert.equal(outboxRows.length, 1);
  } finally {
    if (organizationId) {
      await database.db.delete(organizations).where(eq(organizations.id, organizationId));
    }
    if (identityIds.length) {
      await database.db.delete(identities).where(inArray(identities.id, identityIds));
    }
    await database.onModuleDestroy();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousMediaRoot === undefined) delete process.env.MEDIA_ROOT;
    else process.env.MEDIA_ROOT = previousMediaRoot;
    await rm(mediaRoot, { recursive: true, force: true });
  }
});
