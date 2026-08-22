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
  roleBindings,
  units,
} from "@giromesa/db";
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
    await assert.rejects(() =>
      settings.updateOrganization(manager.id, organization.id, { tradeName: "Sem permissão" }),
    );
    await assert.rejects(() =>
      settings.updateUnit(manager.id, organization.id, targetUnit.id, {
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

    const copied = await settings.copy(
      owner.id,
      organization.id,
      sourceUnit.id,
      "settings-copy-0001",
      { targetUnitIds: [targetUnit.id] },
    );
    const replayed = await settings.copy(
      owner.id,
      organization.id,
      sourceUnit.id,
      "settings-copy-0001",
      { targetUnitIds: [targetUnit.id] },
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
    assert.deepEqual(targetBranding?.config.wifi, {
      ssid: "Destino",
      password: "senha-destino",
    });

    const beforeInvalidCopy = structuredClone(targetBranding?.config);
    await assert.rejects(() =>
      settings.copy(owner.id, organization.id, sourceUnit.id, "settings-copy-0002", {
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
