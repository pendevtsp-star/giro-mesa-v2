import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  identities,
  managementPeople,
  managementPersonAccess,
  managementPersonRoleAssignments,
  membershipInvitations,
  memberships,
  organizations,
  roleBindings,
  units,
} from "@giromesa/db";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { PilotPosService } from "../pilot-operations/pilot-pos.service.js";
import { OrganizationsService } from "./organizations.service.js";
import { ScopeService } from "./scope.service.js";

function errorCode(error: unknown) {
  const response = (error as { getResponse?: () => unknown }).getResponse?.();
  return typeof response === "object" && response !== null
    ? (response as { code?: string }).code
    : undefined;
}

it("links an invited person and exposes the employee name to the floor", async (context) => {
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("PILOT_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  try {
    const suffix = randomUUID();
    const scope = new ScopeService(database);
    const organizationService = new OrganizationsService(database, scope);
    const pos = new PilotPosService(database, scope);
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "Invitation integration",
        tradeName: "Invitation integration",
        document: suffix.replaceAll("-", "").slice(0, 14),
        billingState: "active",
      })
      .returning();
    assert.ok(organization);
    const [unit] = await database.db
      .insert(units)
      .values({ organizationId: organization.id, name: "Unidade convite" })
      .returning();
    assert.ok(unit);
    const [owner, waiter] = await database.db
      .insert(identities)
      .values([
        { email: `owner-${suffix}@example.test`, displayName: "Conta proprietária" },
        { email: `waiter-${suffix}@example.test`, displayName: "Conta convidada" },
      ])
      .returning();
    assert.ok(owner && waiter);
    const [ownerMembership] = await database.db
      .insert(memberships)
      .values({ identityId: owner.id, organizationId: organization.id, status: "active" })
      .returning();
    assert.ok(ownerMembership);
    await database.db.insert(roleBindings).values({
      membershipId: ownerMembership.id,
      role: "owner",
    });
    const [person] = await database.db
      .insert(managementPeople)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        name: "João Garçom",
        roleLabel: "Garçom",
        updatedByIdentityId: owner.id,
      })
      .returning();
    assert.ok(person);
    const token = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
    const [invitation] = await database.db
      .insert(membershipInvitations)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        email: waiter.email,
        role: "waiter",
        tokenHash: createHash("sha256").update(token).digest("hex"),
        invitedByIdentityId: owner.id,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    assert.ok(invitation);
    await database.db.insert(managementPersonAccess).values({
      personId: person.id,
      organizationId: organization.id,
      unitId: unit.id,
      email: waiter.email,
      role: "waiter",
      status: "pending",
      invitationId: invitation.id,
      statusChangedAt: new Date(),
      statusChangedByIdentityId: owner.id,
      statusChangeReason: "Convite enviado.",
    });
    await database.db.insert(managementPersonRoleAssignments).values([
      {
        personId: person.id,
        organizationId: organization.id,
        unitId: unit.id,
        role: "waiter",
        provenance: "people_invite",
      },
      {
        personId: person.id,
        organizationId: organization.id,
        unitId: unit.id,
        role: "cashier",
        provenance: "people_invite",
      },
    ]);

    await assert.rejects(
      () => organizationService.acceptInvite(owner.id, { token }),
      (error) => errorCode(error) === "INVITATION_ACCOUNT_MISMATCH",
    );
    const accepted = await organizationService.acceptInvite(waiter.id, { token });

    const [linkedPerson] = await database.db
      .select({ identityId: managementPeople.identityId })
      .from(managementPeople)
      .where(eq(managementPeople.id, person.id));
    assert.equal(linkedPerson?.identityId, waiter.id);
    const bindings = await database.db
      .select({ role: roleBindings.role })
      .from(roleBindings)
      .where(eq(roleBindings.membershipId, accepted.membershipId));
    assert.deepEqual(bindings.map((binding) => binding.role).sort(), ["cashier", "waiter"]);
    const extraToken = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
    await database.db.insert(membershipInvitations).values({
      organizationId: organization.id,
      unitId: unit.id,
      email: waiter.email,
      role: "delivery",
      tokenHash: createHash("sha256").update(extraToken).digest("hex"),
      invitedByIdentityId: owner.id,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await assert.rejects(
      () => organizationService.acceptInvite(waiter.id, { token: extraToken }),
      (error) => errorCode(error) === "PERSON_ROLE_ASSIGNMENT_REQUIRED",
    );
    const assignments = await database.db
      .select({
        role: managementPersonRoleAssignments.role,
        roleBindingId: managementPersonRoleAssignments.roleBindingId,
      })
      .from(managementPersonRoleAssignments)
      .where(eq(managementPersonRoleAssignments.personId, person.id));
    assert.equal(
      assignments.every((assignment) => Boolean(assignment.roleBindingId)),
      true,
    );
    const floor = await pos.listFloor(owner.id, organization.id, unit.id);
    assert.equal(
      floor.staff.find((candidate) => candidate.identityId === waiter.id)?.displayName,
      "João Garçom",
    );
  } finally {
    await database.onModuleDestroy();
  }
});
