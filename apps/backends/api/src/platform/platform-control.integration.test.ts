import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  auditEvents,
  commercialCatalogVersions,
  commercialPlans,
  identities,
  organizations,
  platformActionReceipts,
  trials,
} from "@giromesa/db";
import { eq, inArray } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
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

    const service = new PlatformControlService(database);
    const before = new Date();
    const granted = await service.grantPilotAccess(
      actor.id,
      organization.id,
      `pilot-access-${suffix}`,
      "Cliente piloto aprovado pelo time de produto",
    );
    const after = new Date();
    const [persisted, untouchedForeignTrial, receipt, audit] = await Promise.all([
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
    ]);
    const lowerBound = resolvePilotAccessEndsAt(initialEndsAt, before).endsAt;
    const upperBound = resolvePilotAccessEndsAt(initialEndsAt, after).endsAt;
    const grantedEndsAt = new Date(granted.endsAt);
    assert.equal(granted.replayed, false);
    assert.equal(granted.extended, true);
    assert.equal(grantedEndsAt >= lowerBound && grantedEndsAt <= upperBound, true);
    assert.equal(persisted[0]?.endsAt.toISOString(), granted.endsAt);
    assert.equal(untouchedForeignTrial[0]?.endsAt.toISOString(), initialEndsAt.toISOString());
    assert.equal(receipt.length, 1);
    assert.equal(audit.length, 1);
    assert.equal(audit[0]?.action, "platform.tenant.pilot_access.grant");

    const replay = await service.grantPilotAccess(
      actor.id,
      organization.id,
      `pilot-access-${suffix}`,
      "Cliente piloto aprovado pelo time de produto",
    );
    assert.equal(replay.replayed, true);
    assert.equal(replay.endsAt, granted.endsAt);
  } finally {
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
