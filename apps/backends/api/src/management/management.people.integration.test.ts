import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  identities,
  managementPeople,
  managementPersonAccess,
  managementPersonRoleAssignments,
  memberships,
  organizations,
  passwordCredentials,
  roleBindings,
  terminalOperatorPins,
  units,
} from "@giromesa/db";
import * as argon2 from "argon2";
import { eq } from "drizzle-orm";
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

it("keeps multiple People roles atomic across suspend and reactivate", async (context) => {
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
    const suffix = randomUUID();
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "People multi-role test",
        tradeName: "People multi-role test",
        document: suffix.replaceAll("-", "").slice(0, 14),
      })
      .returning();
    assert.ok(organization);
    const [unit, secondUnit] = await database.db
      .insert(units)
      .values([
        { organizationId: organization.id, name: "People multi-role unit" },
        { organizationId: organization.id, name: "People multi-role second unit" },
      ])
      .returning();
    assert.ok(unit && secondUnit);
    const [owner, employee] = await database.db
      .insert(identities)
      .values([
        { email: `multi-owner-${suffix}@example.test`, displayName: "Owner" },
        { email: `multi-employee-${suffix}@example.test`, displayName: "Employee" },
      ])
      .returning();
    assert.ok(owner && employee);
    const [ownerMembership, employeeMembership] = await database.db
      .insert(memberships)
      .values([
        { identityId: owner.id, organizationId: organization.id, status: "active" },
        { identityId: employee.id, organizationId: organization.id, status: "active" },
      ])
      .returning();
    assert.ok(ownerMembership && employeeMembership);
    const [ownerBinding, employeeBinding] = await database.db
      .insert(roleBindings)
      .values([
        { membershipId: ownerMembership.id, role: "owner" },
        { membershipId: employeeMembership.id, unitId: unit.id, role: "waiter" },
      ])
      .returning();
    assert.ok(ownerBinding && employeeBinding);
    const [person] = await database.db
      .insert(managementPeople)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        identityId: employee.id,
        name: "Pessoa multifunção",
        roleLabel: "Atendimento",
      })
      .returning();
    assert.ok(person);
    await database.db.insert(managementPersonAccess).values({
      personId: person.id,
      organizationId: organization.id,
      unitId: unit.id,
      email: employee.email,
      role: "waiter",
      status: "active",
      membershipId: employeeMembership.id,
      roleBindingId: employeeBinding.id,
    });
    await database.db.insert(managementPersonRoleAssignments).values({
      personId: person.id,
      organizationId: organization.id,
      unitId: unit.id,
      role: "waiter",
      roleBindingId: employeeBinding.id,
      provenance: "people_admin",
    });

    const updated = await management.updatePersonAccess(
      owner.id,
      organization.id,
      unit.id,
      person.id,
      {
        role: "waiter",
        roles: ["waiter", "cashier"],
        expectedRevision: 1,
        reason: "Cobertura de atendimento e caixa",
      },
    );
    assert.deepEqual(updated.roles, ["waiter", "cashier"]);
    assert.equal(updated.revision, 2);
    await assert.rejects(
      () =>
        management.updatePersonAccess(owner.id, organization.id, unit.id, person.id, {
          role: "waiter",
          roles: ["waiter"],
          reason: "Cliente antigo sem revisão",
        }),
      (error) => errorCode(error) === "PERSON_ACCESS_CHANGED",
    );

    const [globalBinding] = await database.db
      .insert(roleBindings)
      .values({ membershipId: employeeMembership.id, role: "delivery" })
      .returning();
    assert.ok(globalBinding);
    await assert.rejects(
      () =>
        management.suspendPersonAccess(owner.id, organization.id, unit.id, person.id, {
          reason: "Suspensão operacional autorizada",
          expectedRevision: 2,
        }),
      (error) => errorCode(error) === "PERSON_GLOBAL_ACCESS_REVIEW_REQUIRED",
    );
    await database.db.delete(roleBindings).where(eq(roleBindings.id, globalBinding.id));

    const suspended = await management.suspendPersonAccess(
      owner.id,
      organization.id,
      unit.id,
      person.id,
      { reason: "Suspensão operacional autorizada", expectedRevision: 2 },
    );
    assert.equal(suspended.revision, 3);
    assert.deepEqual(suspended.roles, ["waiter", "cashier"]);
    const reactivated = await management.reactivatePersonAccess(
      owner.id,
      organization.id,
      unit.id,
      person.id,
      { reason: "Retorno operacional autorizado", expectedRevision: 3 },
    );
    assert.equal(reactivated.revision, 4);
    assert.deepEqual(reactivated.roles, ["waiter", "cashier"]);

    const secondUnitAccess = await management.assignPersonUnitAccess(
      owner.id,
      organization.id,
      unit.id,
      person.id,
      {
        unitId: secondUnit.id,
        role: "waiter",
        roles: ["waiter", "cashier"],
        reason: "Cobertura em segunda unidade",
      },
    );
    assert.deepEqual(secondUnitAccess.roles, ["waiter", "cashier"]);

    const [orphanBinding] = await database.db
      .insert(roleBindings)
      .values({
        membershipId: employeeMembership.id,
        unitId: unit.id,
        role: "delivery",
      })
      .returning();
    assert.ok(orphanBinding);
    await assert.rejects(
      () =>
        management.updatePersonAccess(owner.id, organization.id, unit.id, person.id, {
          role: "waiter",
          roles: ["waiter", "cashier"],
          expectedRevision: 4,
          reason: "Tentativa com vínculo órfão",
        }),
      (error) => errorCode(error) === "PERSON_ROLE_ASSIGNMENT_REQUIRED",
    );
    await database.db.delete(roleBindings).where(eq(roleBindings.id, orphanBinding.id));
    await assert.rejects(
      () =>
        management.changePersonStatus(owner.id, organization.id, unit.id, person.id, false, {
          reason: "Desligamento com revisão antiga",
          expectedRevision: 3,
        }),
      (error) => errorCode(error) === "PERSON_ACCESS_CHANGED",
    );
    const [offboardingGlobalBinding] = await database.db
      .insert(roleBindings)
      .values({ membershipId: employeeMembership.id, role: "delivery" })
      .returning();
    assert.ok(offboardingGlobalBinding);
    await assert.rejects(
      () =>
        management.changePersonStatus(owner.id, organization.id, unit.id, person.id, false, {
          reason: "Desligamento com acesso global",
        }),
      (error) => errorCode(error) === "PERSON_GLOBAL_ACCESS_REVIEW_REQUIRED",
    );
    await database.db.delete(roleBindings).where(eq(roleBindings.id, offboardingGlobalBinding.id));
    const offboarded = await management.changePersonStatus(
      owner.id,
      organization.id,
      unit.id,
      person.id,
      false,
      { reason: "Desligamento confirmado", expectedRevision: 4 },
    );
    assert.equal(offboarded.active, false);
    const remainingAssignments = await database.db
      .select({ id: managementPersonRoleAssignments.id })
      .from(managementPersonRoleAssignments)
      .where(eq(managementPersonRoleAssignments.personId, person.id));
    assert.equal(remainingAssignments.length, 0);
  } finally {
    await database.onModuleDestroy();
  }
});

it("creates an express employee ready for PIN operations and management records", async (context) => {
  const databaseUrl = process.env.MANAGEMENT_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("MANAGEMENT_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const previousPepper = process.env.TERMINAL_PIN_PEPPER;
  process.env.TERMINAL_PIN_PEPPER = "people-express-integration-test-pepper";
  const database = new DatabaseService();
  try {
    const management = new ManagementService(database, new ScopeService(database));
    const suffix = randomUUID();
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "People express test",
        tradeName: "People express test",
        document: suffix.replaceAll("-", "").slice(0, 14),
      })
      .returning();
    assert.ok(organization);
    const [unit] = await database.db
      .insert(units)
      .values({ organizationId: organization.id, name: "Express unit" })
      .returning();
    assert.ok(unit);
    const [owner] = await database.db
      .insert(identities)
      .values({ email: `express-owner-${suffix}@example.test`, displayName: "Owner" })
      .returning();
    assert.ok(owner);
    const [ownerMembership] = await database.db
      .insert(memberships)
      .values({ identityId: owner.id, organizationId: organization.id, status: "active" })
      .returning();
    assert.ok(ownerMembership);
    await database.db
      .insert(roleBindings)
      .values({ membershipId: ownerMembership.id, role: "owner" });

    const person = await management.createPerson(owner.id, organization.id, unit.id, {
      name: "Funcionário expresso",
      roleLabel: "Atendimento",
      expressAccess: { roles: ["waiter", "cashier"], pin: "123456" },
    });
    assert.ok(person.identityId);
    assert.equal(person.access.status, "active");
    assert.equal(person.access.managed, true);
    assert.equal(person.access.email, undefined);

    const [managedIdentity] = await database.db
      .select()
      .from(identities)
      .where(eq(identities.id, person.identityId))
      .limit(1);
    assert.ok(managedIdentity);
    assert.ok(managedIdentity.email.endsWith("@terminal.giromesa.invalid"));
    assert.equal(managedIdentity.emailVerifiedAt, null);
    const credentials = await database.db
      .select()
      .from(passwordCredentials)
      .where(eq(passwordCredentials.identityId, person.identityId));
    assert.equal(credentials.length, 0);

    const [membership] = await database.db
      .select()
      .from(memberships)
      .where(eq(memberships.identityId, person.identityId))
      .limit(1);
    assert.equal(membership?.status, "active");
    assert.ok(membership);
    const bindings = await database.db
      .select({ role: roleBindings.role, unitId: roleBindings.unitId })
      .from(roleBindings)
      .where(eq(roleBindings.membershipId, membership.id));
    assert.deepEqual(bindings.map((binding) => binding.role).sort(), ["cashier", "waiter"]);
    assert.equal(
      bindings.every((binding) => binding.unitId === unit.id),
      true,
    );

    const assignments = await database.db
      .select({ role: managementPersonRoleAssignments.role })
      .from(managementPersonRoleAssignments)
      .where(eq(managementPersonRoleAssignments.personId, person.id));
    assert.deepEqual(assignments.map((assignment) => assignment.role).sort(), [
      "cashier",
      "waiter",
    ]);
    const [pin] = await database.db
      .select()
      .from(terminalOperatorPins)
      .where(eq(terminalOperatorPins.membershipId, membership.id))
      .limit(1);
    assert.ok(pin?.active);
    const protectedPin = createHmac("sha256", process.env.TERMINAL_PIN_PEPPER)
      .update(`${membership.id}:123456`)
      .digest("base64url");
    assert.equal(await argon2.verify(pin.pinHash, protectedPin), true);

    const schedule = await management.createSchedule(owner.id, organization.id, unit.id, {
      personId: person.id,
      startsAt: "2032-01-10T12:00:00.000Z",
      endsAt: "2032-01-10T20:00:00.000Z",
      breakMinutes: 30,
    });
    assert.ok(schedule);
    assert.equal(schedule.personId, person.id);
  } finally {
    if (previousPepper === undefined) delete process.env.TERMINAL_PIN_PEPPER;
    else process.env.TERMINAL_PIN_PEPPER = previousPepper;
    await database.onModuleDestroy();
  }
});
