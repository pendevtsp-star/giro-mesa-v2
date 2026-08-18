import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import { identities, memberships, organizations, roleBindings, units } from "@giromesa/db";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { ManagementService } from "./management.service.js";

function errorCode(error: unknown) {
  const response = (error as { getResponse?: () => unknown }).getResponse?.();
  return typeof response === "object" && response !== null
    ? (response as { code?: string }).code
    : undefined;
}

function settledSummary(results: PromiseSettledResult<unknown>[]) {
  return results.map((result) =>
    result.status === "fulfilled"
      ? "fulfilled"
      : {
          code: errorCode(result.reason),
          message: String(result.reason),
          cause: String((result.reason as { cause?: unknown })?.cause),
        },
  );
}

it("enforces People policy and serializes overlapping schedules and closures", async (context) => {
  const databaseUrl = process.env.MANAGEMENT_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("MANAGEMENT_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  try {
    const scope = new ScopeService(database);
    const management = new ManagementService(database, scope);
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "People concurrency test",
        tradeName: "People concurrency test",
        document: String(Date.now()).padStart(14, "0").slice(-14),
      })
      .returning();
    assert.ok(organization);
    const [unit] = await database.db
      .insert(units)
      .values({ organizationId: organization.id, name: "People unit" })
      .returning();
    assert.ok(unit);
    const [owner, manager] = await database.db
      .insert(identities)
      .values([
        { email: `people-owner-${randomUUID()}@example.test`, displayName: "People owner" },
        { email: `people-manager-${randomUUID()}@example.test`, displayName: "People manager" },
      ])
      .returning();
    assert.ok(owner && manager);
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
      { membershipId: managerMembership.id, role: "manager", unitId: unit.id },
    ]);

    const capabilities = await management.peopleCapabilities(manager.id, organization.id, unit.id);
    assert.equal(capabilities.canView, false);
    assert.equal(capabilities.canManage, false);
    await assert.rejects(
      () =>
        management.peopleDirectory(manager.id, organization.id, unit.id, {
          q: undefined,
          role: undefined,
          status: "all",
          page: 1,
          pageSize: 20,
        }),
      (error) => errorCode(error) === "TIME_TRACKING_MANAGER_VIEW_DISABLED",
    );

    const person = await management.createPerson(owner.id, organization.id, unit.id, {
      name: "Pessoa concorrente",
      roleLabel: "Atendimento",
    });
    assert.ok(person);
    const schedules = await Promise.allSettled([
      management.createSchedule(owner.id, organization.id, unit.id, {
        personId: person.id,
        startsAt: "2031-01-10T12:00:00.000Z",
        endsAt: "2031-01-10T20:00:00.000Z",
        breakMinutes: 30,
      }),
      management.createSchedule(owner.id, organization.id, unit.id, {
        personId: person.id,
        startsAt: "2031-01-10T18:00:00.000Z",
        endsAt: "2031-01-10T22:00:00.000Z",
        breakMinutes: 15,
      }),
    ]);
    assert.equal(
      schedules.filter((result) => result.status === "fulfilled").length,
      1,
      JSON.stringify(settledSummary(schedules)),
    );
    assert.equal(
      schedules.some(
        (result) => result.status === "rejected" && errorCode(result.reason) === "SCHEDULE_OVERLAP",
      ),
      true,
    );

    const closures = await Promise.allSettled([
      management.closeTimeTrackingPeriod(
        owner.id,
        organization.id,
        unit.id,
        `people-close-${randomUUID()}`,
        { from: "2031-02-01", to: "2031-02-15", reason: "Fechamento A" },
      ),
      management.closeTimeTrackingPeriod(
        owner.id,
        organization.id,
        unit.id,
        `people-close-${randomUUID()}`,
        { from: "2031-02-10", to: "2031-02-20", reason: "Fechamento B" },
      ),
    ]);
    assert.equal(
      closures.filter((result) => result.status === "fulfilled").length,
      1,
      JSON.stringify(settledSummary(closures)),
    );
    assert.equal(
      closures.some(
        (result) =>
          result.status === "rejected" &&
          errorCode(result.reason) === "TIME_TRACKING_PERIOD_ALREADY_CLOSED",
      ),
      true,
    );
  } finally {
    await database.onModuleDestroy();
  }
});
