import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  auditEvents,
  commercialCatalogVersions,
  commercialPlans,
  growthIntegrations,
  identities,
  legalEntities,
  memberships,
  onboardingRecords,
  organizations,
  outboxEvents,
  platformActionReceipts,
  roleBindings,
  trials,
  units,
} from "@giromesa/db";
import { and, eq, inArray } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { platformAccessForEmail } from "./platform-access.js";
import { PlatformControlService, resolvePilotAccessEndsAt } from "./platform-control.service.js";

test("persists, audits and replays a six-month pilot grant without touching another tenant", async (context) => {
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("PILOT_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  const organizationIds: string[] = [];
  const trialIds: string[] = [];
  let actorIdentityId: string | undefined;
  let catalogId: string | undefined;
  try {
    const suffix = randomUUID();
    const [actor] = await database.db
      .insert(identities)
      .values({ email: `platform-pilot+${suffix}@example.test`, displayName: "Platform Pilot" })
      .returning({ id: identities.id });
    assert.ok(actor);
    actorIdentityId = actor.id;

    const [catalog] = await database.db
      .insert(commercialCatalogVersions)
      .values({
        version: Number.parseInt(suffix.replaceAll("-", "").slice(0, 7), 16),
        status: "draft",
      })
      .returning({ id: commercialCatalogVersions.id });
    assert.ok(catalog);
    catalogId = catalog.id;
    const [plan] = await database.db
      .insert(commercialPlans)
      .values({
        catalogVersionId: catalog.id,
        slug: `pilot-${suffix.slice(0, 8)}`,
        name: "Pilot",
        monthlyPriceCents: 1,
        annualPriceCents: 1,
        includedUnits: 1,
        entitlements: ["salon", "doseclub.subscription"],
      })
      .returning({ id: commercialPlans.id });
    assert.ok(plan);

    const documentPrefix = suffix.replaceAll("-", "").slice(0, 13);
    const [organization, foreignOrganization] = await database.db
      .insert(organizations)
      .values([
        {
          legalName: "Pilot Tenant Ltda",
          tradeName: "Pilot Tenant",
          document: `${documentPrefix}1`,
          billingState: "trial_active",
        },
        {
          legalName: "Foreign Pilot Tenant Ltda",
          tradeName: "Foreign Pilot Tenant",
          document: `${documentPrefix}2`,
          billingState: "trial_active",
        },
      ])
      .returning({ id: organizations.id });
    assert.ok(organization && foreignOrganization);
    organizationIds.push(organization.id, foreignOrganization.id);

    const startsAt = new Date();
    const initialEndsAt = new Date(startsAt.getTime() + 14 * 24 * 60 * 60_000);
    const [trial, foreignTrial] = await database.db
      .insert(trials)
      .values([
        {
          organizationId: organization.id,
          commercialPlanId: plan.id,
          startsAt,
          endsAt: initialEndsAt,
          activatedByIdentityId: actor.id,
        },
        {
          organizationId: foreignOrganization.id,
          commercialPlanId: plan.id,
          startsAt,
          endsAt: initialEndsAt,
          activatedByIdentityId: actor.id,
        },
      ])
      .returning({ id: trials.id });
    assert.ok(trial && foreignTrial);
    trialIds.push(trial.id, foreignTrial.id);

    const [unit] = await database.db
      .insert(units)
      .values({ organizationId: organization.id, name: "Matriz", active: true })
      .returning({ id: units.id });
    assert.ok(unit);
    await database.db.insert(growthIntegrations).values({
      organizationId: organization.id,
      unitId: unit.id,
      provider: "doseclub",
      status: "active",
      credentialReference: `managed:v1:${"a".repeat(64)}`,
      config: {
        apiBaseUrl: "https://segredo.example.test",
        clientId: "segredo-client",
        provisioningStatus: "waiting_product_mappings",
        healthCheckedAt: "2026-08-27T12:00:00.000Z",
      },
    });

    const service = new PlatformControlService(database);
    const before = new Date();
    const granted = await service.grantPilotAccess(
      actor.id,
      organization.id,
      `pilot-access-${suffix}`,
      "Cliente piloto aprovado pelo time de produto",
    );
    const after = new Date();
    const [persisted, untouchedForeignTrial, receipt, audit, queued] = await Promise.all([
      database.db
        .select({ endsAt: trials.endsAt })
        .from(trials)
        .where(eq(trials.id, trial.id))
        .limit(1),
      database.db
        .select({ endsAt: trials.endsAt })
        .from(trials)
        .where(eq(trials.id, foreignTrial.id))
        .limit(1),
      database.db
        .select()
        .from(platformActionReceipts)
        .where(eq(platformActionReceipts.actorIdentityId, actor.id)),
      database.db.select().from(auditEvents).where(eq(auditEvents.entityId, trial.id)),
      database.db
        .select()
        .from(outboxEvents)
        .where(
          and(eq(outboxEvents.aggregateType, "trial"), eq(outboxEvents.aggregateId, trial.id)),
        ),
    ]);
    const lowerBound = resolvePilotAccessEndsAt(initialEndsAt, before).endsAt;
    const upperBound = resolvePilotAccessEndsAt(initialEndsAt, after).endsAt;
    const grantedEndsAt = new Date(granted.endsAt);
    assert.equal(granted.replayed, false);
    assert.equal(granted.extended, true);
    assert.equal(granted.doseClubQueued, true);
    assert.equal(grantedEndsAt >= lowerBound && grantedEndsAt <= upperBound, true);
    assert.equal(persisted[0]?.endsAt.toISOString(), granted.endsAt);
    assert.equal(untouchedForeignTrial[0]?.endsAt.toISOString(), initialEndsAt.toISOString());
    assert.equal(receipt.length, 1);
    assert.equal(audit.length, 1);
    assert.equal(audit[0]?.action, "platform.tenant.pilot_access.grant");
    assert.equal(queued.length, 1);

    const access = platformAccessForEmail(
      "platform-pilot@example.test",
      "platform-pilot@example.test=admin",
      "",
    );
    assert.ok(access);
    const tenant = await service.tenant360(organization.id, access);
    assert.deepEqual(tenant.doseClub.connections[0], {
      id: tenant.doseClub.connections[0]?.id,
      unitId: unit.id,
      unitName: "Matriz",
      status: "active",
      managed: true,
      provisioningStatus: "waiting_product_mappings",
      healthCheckedAt: "2026-08-27T12:00:00.000Z",
      updatedAt: tenant.doseClub.connections[0]?.updatedAt,
    });
    assert.equal(tenant.doseClub.entitled, true);
    assert.equal(JSON.stringify(tenant.doseClub).includes("segredo"), false);

    const replay = await service.grantPilotAccess(
      actor.id,
      organization.id,
      `pilot-access-${suffix}`,
      "Cliente piloto aprovado pelo time de produto",
    );
    assert.equal(replay.replayed, true);
    assert.equal(replay.endsAt, granted.endsAt);
    const replayedQueue = await database.db
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.aggregateType, "trial"), eq(outboxEvents.aggregateId, trial.id)));
    assert.equal(replayedQueue.length, 1);
  } finally {
    if (trialIds.length > 0) {
      await database.db.delete(outboxEvents).where(inArray(outboxEvents.aggregateId, trialIds));
    }
    if (actorIdentityId) {
      await database.db
        .delete(platformActionReceipts)
        .where(eq(platformActionReceipts.actorIdentityId, actorIdentityId));
    }
    if (organizationIds.length > 0) {
      await database.db.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    if (actorIdentityId)
      await database.db.delete(identities).where(eq(identities.id, actorIdentityId));
    if (catalogId)
      await database.db
        .delete(commercialCatalogVersions)
        .where(eq(commercialCatalogVersions.id, catalogId));
    await database.client.end();
  }
});

test("provisions an existing owner tenant without making the platform actor a member", async (context) => {
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("PILOT_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  const identityIds: string[] = [];
  let organizationId: string | undefined;
  try {
    const suffix = randomUUID();
    const [actor, owner, unverifiedOwner] = await database.db
      .insert(identities)
      .values([
        {
          email: `platform-actor+${suffix}@example.test`,
          displayName: "Platform Actor",
          emailVerifiedAt: new Date(),
        },
        {
          email: `pilot-owner+${suffix}@example.test`,
          displayName: "Pilot Owner",
          emailVerifiedAt: new Date(),
        },
        {
          email: `pilot-unverified+${suffix}@example.test`,
          displayName: "Pilot Unverified",
        },
      ])
      .returning({ id: identities.id, email: identities.email });
    assert.ok(actor && owner && unverifiedOwner);
    identityIds.push(actor.id, owner.id, unverifiedOwner.id);

    const documentPrefix = suffix.replaceAll("-", "").slice(0, 12).toUpperCase();
    const input = {
      legalName: "Pilot Tenant Ltda",
      tradeName: "Pilot Tenant",
      document: `${documentPrefix}11`,
      unitName: "Matriz",
      timezone: "America/Sao_Paulo",
      ownerEmail: owner.email,
      reason: "Cliente piloto aprovado pelo time de produto",
    };
    const service = new PlatformControlService(database);
    await assert.rejects(
      service.registerTenant(actor.id, `tenant-unverified-${suffix}`, {
        ...input,
        ownerEmail: unverifiedOwner.email,
      }),
      (error: unknown) => {
        if (!error || typeof error !== "object" || !("getResponse" in error)) return false;
        const response = (error as { getResponse: () => unknown }).getResponse();
        return (
          response !== null &&
          typeof response === "object" &&
          "code" in response &&
          response.code === "PLATFORM_TENANT_OWNER_EMAIL_UNVERIFIED"
        );
      },
    );
    const created = await service.registerTenant(actor.id, `tenant-create-${suffix}`, input);
    organizationId = created.organization.id;

    assert.equal(created.replayed, false);
    assert.equal(created.organization.billingState, "onboarding");
    assert.equal(created.owner.identityId, owner.id);
    assert.equal(created.owner.email, owner.email);
    const [
      organization,
      entity,
      unit,
      ownerMembership,
      actorMembership,
      onboarding,
      audit,
      outbox,
    ] = await Promise.all([
      database.db
        .select()
        .from(organizations)
        .where(eq(organizations.id, created.organization.id))
        .limit(1),
      database.db
        .select()
        .from(legalEntities)
        .where(eq(legalEntities.organizationId, created.organization.id))
        .limit(1),
      database.db.select().from(units).where(eq(units.id, created.unit.id)).limit(1),
      database.db
        .select({
          identityId: memberships.identityId,
          status: memberships.status,
          role: roleBindings.role,
        })
        .from(memberships)
        .innerJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
        .where(
          and(
            eq(memberships.organizationId, created.organization.id),
            eq(memberships.identityId, owner.id),
          ),
        )
        .limit(1),
      database.db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, created.organization.id),
            eq(memberships.identityId, actor.id),
          ),
        )
        .limit(1),
      database.db
        .select()
        .from(onboardingRecords)
        .where(eq(onboardingRecords.organizationId, created.organization.id))
        .limit(1),
      database.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.organizationId, created.organization.id))
        .limit(1),
      database.db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.aggregateId, created.organization.id))
        .limit(1),
    ]);
    assert.equal(organization[0]?.billingState, "onboarding");
    assert.equal(entity[0]?.document, input.document);
    assert.equal(unit[0]?.legalEntityId, entity[0]?.id);
    assert.deepEqual(ownerMembership[0], { identityId: owner.id, status: "active", role: "owner" });
    assert.equal(actorMembership.length, 0);
    assert.equal(onboarding.length, 1);
    assert.equal(audit[0]?.action, "platform.tenant.created");
    assert.equal(audit[0]?.actorIdentityId, actor.id);
    assert.equal(outbox[0]?.topic, "organization.created");

    const replay = await service.registerTenant(actor.id, `tenant-create-${suffix}`, input);
    assert.equal(replay.replayed, true);
    assert.equal(replay.organization.id, created.organization.id);
  } finally {
    if (organizationId) {
      await database.db
        .delete(platformActionReceipts)
        .where(eq(platformActionReceipts.actorIdentityId, identityIds[0] ?? ""));
      await database.db.delete(auditEvents).where(eq(auditEvents.organizationId, organizationId));
      await database.db.delete(outboxEvents).where(eq(outboxEvents.aggregateId, organizationId));
      await database.db.delete(organizations).where(eq(organizations.id, organizationId));
    }
    if (identityIds.length > 0) {
      await database.db.delete(identities).where(inArray(identities.id, identityIds));
    }
    await database.client.end();
  }
});
