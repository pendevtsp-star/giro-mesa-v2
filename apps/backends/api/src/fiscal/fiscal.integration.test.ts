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
  fiscalProfiles,
  identities,
  legalEntities,
  memberships,
  organizations,
  outboxEvents,
  posCatalogCategories,
  posOrderItems,
  posOrders,
  posProducts,
  posTabs,
  productTaxRevisions,
  roleBindings,
  units,
  writeFiscalArtifact,
} from "@giromesa/db";
import { and, eq, inArray } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { FiscalService, localDateAt } from "./fiscal.service.js";
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
    const [owner, accountant, outsider] = await database.db
      .insert(identities)
      .values([
        { email: `fiscal-owner-${randomUUID()}@example.test`, displayName: "Fiscal Owner" },
        {
          email: `fiscal-accountant-${randomUUID()}@example.test`,
          displayName: "Fiscal Accountant",
        },
        { email: `fiscal-outsider-${randomUUID()}@example.test`, displayName: "Outsider" },
      ])
      .returning();
    assert.ok(owner && accountant && outsider);
    identityIds.push(owner.id, accountant.id, outsider.id);
    const [membership, accountantMembership] = await database.db
      .insert(memberships)
      .values([
        { identityId: owner.id, organizationId: organization.id, status: "active" },
        { identityId: accountant.id, organizationId: organization.id, status: "active" },
      ])
      .returning();
    assert.ok(membership && accountantMembership);
    await database.db.insert(roleBindings).values([
      { membershipId: membership.id, role: "owner" },
      { membershipId: accountantMembership.id, role: "accountant" },
    ]);
    await assert.rejects(
      () => fiscal.dashboard(outsider.id, organizationId as string, unit.id),
      hasCode("UNIT_ACCESS_DENIED"),
    );

    const [category] = await database.db
      .insert(posCatalogCategories)
      .values({ organizationId: organization.id, name: "Pratos", slug: `pratos-${randomUUID()}` })
      .returning();
    assert.ok(category);
    const [product] = await database.db
      .insert(posProducts)
      .values({ organizationId: organization.id, categoryId: category.id, name: "Produto fiscal" })
      .returning();
    assert.ok(product);
    const classification = {
      ncm: "21069090",
      cfop: "5102",
      origin: 0,
      csosn: "102",
      cstPis: "49",
      cstCofins: "49",
      cstIbsCbs: "000",
      cClassTrib: "000001",
    };
    await fiscal.createTaxRevision(owner.id, organization.id, unit.id, {
      productId: product.id,
      status: "active",
      effectiveFrom: "2026-08-01",
      classification,
    });
    await fiscal.createTaxRevision(owner.id, organization.id, unit.id, {
      productId: product.id,
      status: "active",
      effectiveFrom: "2026-09-01",
      classification,
    });
    const scheduledRevisions = await database.db
      .select({
        status: productTaxRevisions.status,
        effectiveUntil: productTaxRevisions.effectiveUntil,
      })
      .from(productTaxRevisions)
      .where(eq(productTaxRevisions.productId, product.id))
      .orderBy(productTaxRevisions.version);
    assert.deepEqual(
      scheduledRevisions.map((revision) => [revision.status, revision.effectiveUntil]),
      [
        ["active", "2026-08-31"],
        ["active", null],
      ],
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
    const replayedDownload = await fiscal.accountantPackageContent(
      owner.id,
      organizationId,
      unit.id,
      "2026-08",
    );
    assert.equal(replayedDownload.sha256, download.sha256);
    assert.equal(replayedDownload.content, download.content);
    const available = await fiscal.accountantPackage(owner.id, organizationId, unit.id, "2026-08");
    assert.equal(available.status, "available");
    assert.equal("period" in available, false);
    assert.equal("accountingPackage" in available, false);
    const createdRequest = await fiscal.createAccountantRequest(
      owner.id,
      organizationId,
      unit.id,
      `accounting-${randomUUID()}`,
      {
        competence: "2026-08",
        title: "Conferir competência",
        description: "Validar o pacote contábil fechado.",
      },
    );
    assert.equal("idempotencyKey" in createdRequest.request, false);
    assert.equal(createdRequest.request.targetAudience, "accountant");
    await assert.rejects(
      () =>
        fiscal.resolveAccountantRequest(
          owner.id,
          organizationId as string,
          unit.id,
          createdRequest.request.id,
          {
            resolution: "Tentativa do autor.",
          },
        ),
      hasCode("ACCOUNTANT_REQUEST_SELF_RESOLUTION_DENIED"),
    );
    const attachment = await fiscal.createAccountantAttachment(
      owner.id,
      organizationId,
      unit.id,
      createdRequest.request.id,
      {
        fileName: "fechamento.csv",
        contentType: "text/csv",
        contentBase64: Buffer.from("documento;valor\n42;5000").toString("base64"),
      },
    );
    assert.equal("storageKey" in attachment.attachment, false);
    const attachmentContent = await fiscal.accountantAttachmentContent(
      accountant.id,
      organizationId,
      unit.id,
      createdRequest.request.id,
      attachment.attachment.id,
    );
    assert.equal(
      Buffer.from(attachmentContent.content, "base64").toString(),
      "documento;valor\n42;5000",
    );
    await assert.rejects(
      () =>
        fiscal.accountantAttachmentContent(
          outsider.id,
          organizationId as string,
          unit.id,
          createdRequest.request.id,
          attachment.attachment.id,
        ),
      hasCode("UNIT_ACCESS_DENIED"),
    );
    const resolutions = await Promise.all([
      fiscal.resolveAccountantRequest(
        accountant.id,
        organizationId,
        unit.id,
        createdRequest.request.id,
        { resolution: "Documentos conferidos." },
      ),
      fiscal.resolveAccountantRequest(
        accountant.id,
        organizationId,
        unit.id,
        createdRequest.request.id,
        { resolution: "Documentos conferidos." },
      ),
    ]);
    assert.deepEqual(resolutions.map((result) => result.replayed).sort(), [false, true]);
    const accountantCreatedRequest = await fiscal.createAccountantRequest(
      accountant.id,
      organizationId,
      unit.id,
      `accounting-${randomUUID()}`,
      {
        competence: "2026-08",
        title: "Enviar comprovante",
        description: "A empresa deve anexar o comprovante solicitado.",
      },
    );
    assert.equal(accountantCreatedRequest.request.targetAudience, "establishment");
    const [ownerDashboard, accountantDashboard] = await Promise.all([
      fiscal.dashboard(owner.id, organizationId, unit.id),
      fiscal.dashboard(accountant.id, organizationId, unit.id),
    ]);
    assert.equal(ownerDashboard.openAccountantRequests, 1);
    assert.equal(accountantDashboard.openAccountantRequests, 0);
    const ownerResolution = await fiscal.resolveAccountantRequest(
      owner.id,
      organizationId,
      unit.id,
      accountantCreatedRequest.request.id,
      { resolution: "Comprovante anexado." },
    );
    assert.equal(ownerResolution.replayed, false);
    const today = localDateAt(new Date(), unit.timezone);
    const yesterday = new Date(new Date(`${today}T12:00:00.000Z`).getTime() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    await fiscal.createAccountantRequest(
      accountant.id,
      organizationId,
      unit.id,
      `accounting-${randomUUID()}`,
      {
        competence: "2026-08",
        title: "Prazo vencido",
        description: "Solicitação vencida na data local da unidade.",
        dueDate: yesterday,
      },
    );
    await fiscal.createAccountantRequest(
      accountant.id,
      organizationId,
      unit.id,
      `accounting-${randomUUID()}`,
      {
        competence: "2026-08",
        title: "Prazo de hoje",
        description: "Solicitação vence hoje na unidade.",
        dueDate: today,
      },
    );
    const overduePage = await fiscal.accountantRequests(owner.id, organizationId, unit.id, {
      overdue: true,
      targetAudience: "establishment",
      page: 1,
      pageSize: 25,
    });
    assert.deepEqual(
      overduePage.items.map((item) => item.title),
      ["Prazo vencido"],
    );
    const requestPage = await fiscal.accountantRequests(owner.id, organizationId, unit.id, {
      competence: "2026-08",
      targetAudience: "accountant",
      page: 1,
      pageSize: 25,
    });
    assert.equal(requestPage.items[0]?.createdByName, "Fiscal Owner");
    assert.equal("storageKey" in (requestPage.items[0] ?? {}), false);
    assert.equal("storageKey" in (requestPage.items[0]?.attachments[0] ?? {}), false);
    const resolutionAudit = await database.db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, organizationId),
          eq(auditEvents.action, "accounting.request.resolved"),
          eq(auditEvents.entityId, createdRequest.request.id),
        ),
      );
    assert.equal(resolutionAudit.length, 1);
    const [legalEntity] = await database.db
      .insert(legalEntities)
      .values({
        organizationId,
        legalName: "Fiscal Test Ltda",
        document: organization.document,
      })
      .returning();
    assert.ok(legalEntity);
    await database.db.insert(fiscalProfiles).values({
      organizationId,
      unitId: unit.id,
      legalEntityId: legalEntity.id,
      taxRegime: "simples_nacional",
      crt: "1",
      stateCode: "SP",
      cityCode: "3550308",
      environment: "homologation",
      settings: {},
    });
    const [tab] = await database.db
      .insert(posTabs)
      .values({ organizationId, unitId: unit.id, openedByIdentityId: owner.id })
      .returning();
    assert.ok(tab);
    const [order] = await database.db
      .insert(posOrders)
      .values({
        organizationId,
        unitId: unit.id,
        tabId: tab.id,
        createdByIdentityId: owner.id,
      })
      .returning();
    assert.ok(order);
    await database.db.insert(posOrderItems).values({
      organizationId,
      unitId: unit.id,
      orderId: order.id,
      productId: product.id,
      productName: product.name,
      quantity: 1,
      unitPriceCents: 2_500,
      grossCents: 2_500,
      netCents: 2_500,
    });
    const providerReference = Array.from({ length: 44 }, () => randomInt(0, 10)).join("");
    const linkedDocument = await fiscal.ingestEdgeEvent(
      {
        id: `edge-${randomUUID()}`,
        type: "fiscal.document.issue_result",
        occurredAt: "2026-10-20T12:00:00.000Z",
        payload: {
          kind: "fiscal.document.issue_result",
          orderId: order.id,
          idempotencyKey: `edge-issue-${randomUUID()}`,
          status: "authorized",
          providerReference,
        },
      },
      { organizationId, unitId: unit.id, hubId: "integration-hub" },
    );
    assert.equal(linkedDocument.document?.tabId, tab.id);
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
      await database.db
        .delete(posOrderItems)
        .where(eq(posOrderItems.organizationId, organizationId));
      await database.db
        .delete(fiscalDocuments)
        .where(eq(fiscalDocuments.organizationId, organizationId));
      await database.db.delete(posOrders).where(eq(posOrders.organizationId, organizationId));
      await database.db.delete(posTabs).where(eq(posTabs.organizationId, organizationId));
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
