import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  auditEvents,
  identities,
  memberships,
  organizations,
  outboxEvents,
  posCatalogBranding,
  posCatalogCategories,
  posDiningRooms,
  posDiningTables,
  posOrders,
  posProductionStations,
  posProductPrices,
  posProducts,
  posTabs,
  roleBindings,
  units,
} from "@giromesa/db";
import { ForbiddenException } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { PilotCatalogService } from "../pilot-operations/pilot-catalog.service.js";
import {
  closedBusinessHours,
  EstablishmentSettingsService,
  normalizeStoredBranding,
} from "./establishment-settings.service.js";
import { ScopeService } from "./scope.service.js";

it("persists and atomically copies tenant-scoped establishment settings", async (context) => {
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("PILOT_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  const organizationIds: string[] = [];
  const identityIds: string[] = [];
  try {
    const suffix = randomUUID();
    const documentPrefix = suffix.replaceAll("-", "").slice(0, 13);
    const [organization, foreignOrganization] = await database.db
      .insert(organizations)
      .values([
        {
          legalName: "Configurações Ltda",
          tradeName: "Casa Original",
          document: `${documentPrefix}1`,
          billingState: "active",
        },
        {
          legalName: "Outro Tenant Ltda",
          tradeName: "Outro Tenant",
          document: `${documentPrefix}2`,
          billingState: "active",
        },
      ])
      .returning();
    assert.ok(organization && foreignOrganization);
    organizationIds.push(organization.id, foreignOrganization.id);
    const [sourceUnit, targetUnit, foreignUnit] = await database.db
      .insert(units)
      .values([
        { organizationId: organization.id, name: "Origem" },
        { organizationId: organization.id, name: "Destino" },
        { organizationId: foreignOrganization.id, name: "Fora do tenant" },
      ])
      .returning();
    assert.ok(sourceUnit && targetUnit && foreignUnit);
    const [owner, manager] = await database.db
      .insert(identities)
      .values([
        { email: `settings-owner+${suffix}@example.test`, displayName: "Owner" },
        { email: `settings-manager+${suffix}@example.test`, displayName: "Manager" },
      ])
      .returning();
    assert.ok(owner && manager);
    identityIds.push(owner.id, manager.id);
    const [ownerMembership, managerMembership] = await database.db
      .insert(memberships)
      .values([
        { identityId: owner.id, organizationId: organization.id, status: "active" },
        { identityId: manager.id, organizationId: organization.id, status: "active" },
      ])
      .returning();
    assert.ok(ownerMembership && managerMembership);
    await database.db.insert(roleBindings).values([
      { membershipId: ownerMembership.id, role: "owner" },
      { membershipId: managerMembership.id, unitId: sourceUnit.id, role: "manager" },
      { membershipId: managerMembership.id, unitId: targetUnit.id, role: "waiter" },
    ]);

    const scope = new ScopeService(database);
    const settings = new EstablishmentSettingsService(database, scope);
    const initialChannelChecks = await settings.channelChecks(
      owner.id,
      organization.id,
      sourceUnit.id,
    );
    assert.equal(initialChannelChecks.checks.length, 6);
    assert.ok(initialChannelChecks.checks.every((check) => check.status === "not_tested"));
    const qrCheck = await settings.recordChannelCheck(
      owner.id,
      organization.id,
      sourceUnit.id,
      "channel-check-qr",
      {
        channel: "qr",
        status: "passed",
        evidenceReference: "pedido TESTE-QR-001",
        note: "Leitura no celular abriu a mesa correta.",
      },
    );
    const replayedQrCheck = await settings.recordChannelCheck(
      owner.id,
      organization.id,
      sourceUnit.id,
      "channel-check-qr",
      {
        channel: "qr",
        status: "passed",
        evidenceReference: "pedido TESTE-QR-001",
        note: "Leitura no celular abriu a mesa correta.",
      },
    );
    assert.deepEqual(replayedQrCheck, qrCheck);
    await assert.rejects(() =>
      settings.recordChannelCheck(owner.id, organization.id, sourceUnit.id, "channel-check-qr", {
        channel: "qr",
        status: "failed",
        evidenceReference: "pedido TESTE-QR-002",
        note: "Leitura abriu uma mesa incorreta no celular.",
      }),
    );
    await settings.recordChannelCheck(
      manager.id,
      organization.id,
      sourceUnit.id,
      "channel-check-cash",
      {
        channel: "cash",
        status: "failed",
        evidenceReference: "turno TESTE-CAIXA-001",
        note: "Fechamento divergente; conferir a gaveta.",
      },
    );
    const persistedChannelChecks = await settings.channelChecks(
      manager.id,
      organization.id,
      sourceUnit.id,
    );
    assert.equal(
      persistedChannelChecks.checks.find((check) => check.channel === "qr")?.status,
      "passed",
    );
    assert.equal(
      persistedChannelChecks.checks.find((check) => check.channel === "cash")?.status,
      "failed",
    );
    assert.equal(
      persistedChannelChecks.checks.find((check) => check.channel === "qr")?.actorDisplayName,
      "Owner",
    );
    const channelAuditRows = await database.db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, organization.id),
          eq(auditEvents.unitId, sourceUnit.id),
          eq(auditEvents.action, "settings.channel_check.recorded"),
        ),
      );
    assert.equal(channelAuditRows.length, 2);
    await assert.rejects(() =>
      settings.recordChannelCheck(
        manager.id,
        organization.id,
        targetUnit.id,
        "channel-check-denied",
        {
          channel: "delivery",
          status: "passed",
          evidenceReference: "pedido TESTE-DELIVERY-001",
          note: "Pedido entregue e cobrança conferida.",
        },
      ),
    );
    await assert.rejects(() =>
      settings.channelChecks(owner.id, foreignOrganization.id, foreignUnit.id),
    );
    await assert.rejects(() =>
      settings.updateOrganization(manager.id, organization.id, {
        tradeName: "Sem permissão",
        expectedRevision: organization.updatedAt.toISOString(),
      }),
    );
    await assert.rejects(() =>
      settings.updateUnit(manager.id, organization.id, targetUnit.id, {
        expectedRevision: 0,
        name: "Destino alterado",
        timezone: "America/Sao_Paulo",
        presentation: normalizeStoredBranding({}, "Destino").presentation,
        businessHours: closedBusinessHours(),
      }),
    );

    await database.db.insert(posCatalogBranding).values({
      organizationId: organization.id,
      unitId: targetUnit.id,
      config: {
        ...normalizeStoredBranding({}, "Destino").presentation,
        wifi: { ssid: "Destino", password: "senha-destino" },
        businessHours: closedBusinessHours(),
      },
    });
    const hours = closedBusinessHours();
    hours.weekly[4] = {
      weekday: 5,
      mode: "periods",
      periods: [{ start: "18:00", end: "02:00", endsNextDay: true }],
    };
    await settings.updateUnit(owner.id, organization.id, sourceUnit.id, {
      expectedRevision: 0,
      name: "Origem",
      timezone: "America/Sao_Paulo",
      presentation: {
        ...normalizeStoredBranding({}, "Origem").presentation,
        displayName: "Casa Publicada",
        logoUrl: "https://cdn.example.test/logo.png",
        wifi: { ssid: "Origem", password: "senha-origem" },
      },
      businessHours: hours,
    });
    const legacyCatalog = new PilotCatalogService(database, scope, settings);
    await legacyCatalog.updateBranding(owner.id, organization.id, sourceUnit.id, {
      displayName: "Casa via legado",
      slogan: null,
      logoUrl: "https://cdn.example.test/logo.png",
      coverImageUrl: "https://cdn.example.test/cover.webp",
      primaryColor: "#123456",
      accentColor: "#abcdef",
      openingHours: "Texto do endpoint legado",
      wifi: { ssid: "Origem", password: "senha-origem" },
    });
    const [sourceAfterLegacyUpdate] = await database.db
      .select({ config: posCatalogBranding.config })
      .from(posCatalogBranding)
      .where(eq(posCatalogBranding.unitId, sourceUnit.id))
      .limit(1);
    assert.deepEqual(sourceAfterLegacyUpdate?.config.businessHours, hours);
    assert.equal(
      sourceAfterLegacyUpdate?.config.coverImageUrl,
      "https://cdn.example.test/cover.webp",
    );

    const copied = await settings.copy(
      owner.id,
      organization.id,
      sourceUnit.id,
      "settings-copy-0001",
      { expectedRevision: 2, targetUnitIds: [targetUnit.id] },
    );
    const replayed = await settings.copy(
      owner.id,
      organization.id,
      sourceUnit.id,
      "settings-copy-0001",
      { expectedRevision: 2, targetUnitIds: [targetUnit.id] },
    );
    assert.equal(copied.idempotentReplay, false);
    assert.equal(replayed.idempotentReplay, true);
    const [targetBranding] = await database.db
      .select({ config: posCatalogBranding.config })
      .from(posCatalogBranding)
      .where(
        and(
          eq(posCatalogBranding.organizationId, organization.id),
          eq(posCatalogBranding.unitId, targetUnit.id),
        ),
      )
      .limit(1);
    assert.equal(targetBranding?.config.displayName, "Casa via legado");
    assert.equal(targetBranding?.config.coverImageUrl, "https://cdn.example.test/cover.webp");
    assert.deepEqual(targetBranding?.config.wifi, {
      ssid: "Destino",
      password: "senha-destino",
    });

    const beforeInvalidCopy = structuredClone(targetBranding?.config);
    await assert.rejects(() =>
      settings.copy(owner.id, organization.id, sourceUnit.id, "settings-copy-0002", {
        expectedRevision: 2,
        targetUnitIds: [targetUnit.id, foreignUnit.id],
      }),
    );
    const [afterInvalidCopy] = await database.db
      .select({ config: posCatalogBranding.config })
      .from(posCatalogBranding)
      .where(eq(posCatalogBranding.unitId, targetUnit.id))
      .limit(1);
    assert.deepEqual(afterInvalidCopy?.config, beforeInvalidCopy);
    const copiedAudits = await database.db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, organization.id),
          eq(auditEvents.unitId, targetUnit.id),
          eq(auditEvents.action, "settings.unit.copied"),
        ),
      );
    assert.equal(copiedAudits.length, 1);
    const copiedOutboxEvents = await database.db
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.topic, "settings.unit.copied"),
          eq(outboxEvents.aggregateId, targetUnit.id),
        ),
      );
    assert.equal(copiedOutboxEvents.length, 1);

    const [restorableAudit] = await database.db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, organization.id),
          eq(auditEvents.unitId, sourceUnit.id),
          eq(auditEvents.action, "settings.unit.updated"),
        ),
      )
      .limit(1);
    assert.ok(restorableAudit);
    const restored = await settings.restore(
      owner.id,
      organization.id,
      sourceUnit.id,
      "settings-restore-0001",
      { auditEventId: restorableAudit.id, expectedRevision: 2 },
    );
    assert.equal(restored.revision, 3);
    assert.equal(restored.presentation.displayName, "Casa Publicada");
    assert.deepEqual(restored.presentation.wifi, {
      ssid: "Origem",
      password: "senha-origem",
    });
    await assert.rejects(() =>
      settings.restore(owner.id, organization.id, sourceUnit.id, "settings-restore-stale", {
        auditEventId: restorableAudit.id,
        expectedRevision: 2,
      }),
    );
  } finally {
    if (organizationIds.length) {
      await database.db.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    if (identityIds.length) {
      await database.db.delete(identities).where(inArray(identities.id, identityIds));
    }
    await database.onModuleDestroy();
  }
});

it("projects the first-turn checklist by tenant and unit, and denies a manager outside its unit", async (context) => {
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("PILOT_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  const organizationIds: string[] = [];
  const identityIds: string[] = [];
  try {
    const suffix = randomUUID();
    const documentPrefix = suffix.replaceAll("-", "").slice(0, 13);
    const [organization, foreignOrganization] = await database.db
      .insert(organizations)
      .values([
        {
          legalName: "Checklist Local Ltda",
          tradeName: "Casa Local",
          document: `${documentPrefix}3`,
          billingState: "active",
        },
        {
          legalName: "Checklist Externo Ltda",
          tradeName: "Casa Externa",
          document: `${documentPrefix}4`,
          billingState: "active",
        },
      ])
      .returning();
    assert.ok(organization && foreignOrganization);
    organizationIds.push(organization.id, foreignOrganization.id);
    const [emptyUnit, configuredUnit, foreignUnit] = await database.db
      .insert(units)
      .values([
        { organizationId: organization.id, name: "Ainda vazia" },
        { organizationId: organization.id, name: "Configurada" },
        { organizationId: foreignOrganization.id, name: "Outra casa" },
      ])
      .returning();
    assert.ok(emptyUnit && configuredUnit && foreignUnit);
    const [owner, scopedManager] = await database.db
      .insert(identities)
      .values([
        { email: `summary-owner+${suffix}@example.test`, displayName: "Owner" },
        { email: `summary-manager+${suffix}@example.test`, displayName: "Manager" },
      ])
      .returning();
    assert.ok(owner && scopedManager);
    identityIds.push(owner.id, scopedManager.id);
    const [ownerMembership, managerMembership] = await database.db
      .insert(memberships)
      .values([
        { identityId: owner.id, organizationId: organization.id, status: "active" },
        { identityId: scopedManager.id, organizationId: organization.id, status: "active" },
      ])
      .returning();
    assert.ok(ownerMembership && managerMembership);
    await database.db.insert(roleBindings).values([
      { membershipId: ownerMembership.id, role: "owner" },
      { membershipId: managerMembership.id, unitId: configuredUnit.id, role: "manager" },
    ]);

    const [localCategory, foreignCategory] = await database.db
      .insert(posCatalogCategories)
      .values([
        { organizationId: organization.id, name: "Pratos", slug: `pratos-${suffix}` },
        {
          organizationId: foreignOrganization.id,
          name: "Pratos externos",
          slug: `externos-${suffix}`,
        },
      ])
      .returning();
    assert.ok(localCategory && foreignCategory);
    const [localProduct, foreignProduct] = await database.db
      .insert(posProducts)
      .values([
        { organizationId: organization.id, categoryId: localCategory.id, name: "Prato local" },
        {
          organizationId: foreignOrganization.id,
          categoryId: foreignCategory.id,
          name: "Prato externo",
        },
      ])
      .returning();
    assert.ok(localProduct && foreignProduct);
    await database.db.insert(posProductPrices).values([
      {
        organizationId: organization.id,
        unitId: configuredUnit.id,
        productId: localProduct.id,
        priceCents: 2500,
      },
      {
        organizationId: foreignOrganization.id,
        unitId: foreignUnit.id,
        productId: foreignProduct.id,
        priceCents: 3500,
      },
    ]);
    const [localRoom, foreignRoom] = await database.db
      .insert(posDiningRooms)
      .values([
        { organizationId: organization.id, unitId: configuredUnit.id, name: "Salão" },
        { organizationId: foreignOrganization.id, unitId: foreignUnit.id, name: "Salão externo" },
      ])
      .returning();
    assert.ok(localRoom && foreignRoom);
    await database.db.insert(posDiningTables).values([
      {
        organizationId: organization.id,
        unitId: configuredUnit.id,
        roomId: localRoom.id,
        label: "Mesa 1",
      },
      {
        organizationId: foreignOrganization.id,
        unitId: foreignUnit.id,
        roomId: foreignRoom.id,
        label: "Mesa externa",
      },
    ]);
    await database.db.insert(posProductionStations).values([
      {
        organizationId: organization.id,
        unitId: configuredUnit.id,
        name: "Cozinha",
        code: `kitchen-${suffix.slice(0, 8)}`,
      },
      {
        organizationId: foreignOrganization.id,
        unitId: foreignUnit.id,
        name: "Cozinha externa",
        code: `outside-${suffix.slice(0, 8)}`,
      },
    ]);
    const [localTab, foreignTab] = await database.db
      .insert(posTabs)
      .values([
        {
          organizationId: organization.id,
          unitId: configuredUnit.id,
          openedByIdentityId: owner.id,
          status: "closed",
          closedAt: new Date(),
        },
        {
          organizationId: foreignOrganization.id,
          unitId: foreignUnit.id,
          openedByIdentityId: owner.id,
          status: "closed",
          closedAt: new Date(),
        },
      ])
      .returning();
    assert.ok(localTab && foreignTab);
    await database.db.insert(posOrders).values([
      {
        organizationId: organization.id,
        unitId: configuredUnit.id,
        tabId: localTab.id,
        createdByIdentityId: owner.id,
        status: "served",
      },
      {
        organizationId: foreignOrganization.id,
        unitId: foreignUnit.id,
        tabId: foreignTab.id,
        createdByIdentityId: owner.id,
        status: "served",
      },
    ]);

    const settings = new EstablishmentSettingsService(database, new ScopeService(database));
    const empty = await settings.specializedSummary(owner.id, organization.id, emptyUnit.id);
    assert.deepEqual(empty.setup, {
      activeProducts: 0,
      activeTables: 0,
      activePeople: 1,
      activePrinters: 0,
      completedService: false,
    });
    assert.equal(empty.kds.activeStations, 0);
    const configured = await settings.specializedSummary(
      owner.id,
      organization.id,
      configuredUnit.id,
    );
    assert.deepEqual(configured.setup, {
      activeProducts: 1,
      activeTables: 1,
      activePeople: 2,
      activePrinters: 0,
      completedService: true,
    });
    assert.equal(configured.kds.activeStations, 1);
    await assert.rejects(
      () => settings.specializedSummary(scopedManager.id, organization.id, emptyUnit.id),
      (error: unknown) => error instanceof ForbiddenException && error.getStatus() === 403,
    );
  } finally {
    if (organizationIds.length) {
      await database.db.delete(posOrders).where(inArray(posOrders.organizationId, organizationIds));
      await database.db.delete(posTabs).where(inArray(posTabs.organizationId, organizationIds));
      await database.db.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    if (identityIds.length) {
      await database.db.delete(identities).where(inArray(identities.id, identityIds));
    }
    await database.onModuleDestroy();
  }
});
