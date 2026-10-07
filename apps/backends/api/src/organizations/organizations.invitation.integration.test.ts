import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  identities,
  managementPeople,
  managementPersonAccess,
  managementPersonRoleAssignments,
  membershipInvitations,
  memberships,
  organizations,
  outboxEvents,
  roleBindings,
  units,
} from "@giromesa/db";
import { decryptSecret, encryptionKey } from "@giromesa/domain";
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

it("rejects cross-unit and privileged invitations before writing", async () => {
  const previousEmailProvider = process.env.EMAIL_PROVIDER_ENABLED;
  process.env.EMAIL_PROVIDER_ENABLED = "true";
  try {
    const managerService = new OrganizationsService(
      {} as DatabaseService,
      {
        requireOrganizationRole: async () => [{ role: "manager", unitId: "unit-a" }],
      } as unknown as ScopeService,
    );
    for (const [role, unitId, expectedCode] of [
      ["manager", null, "INVITATION_SCOPE_DENIED"],
      ["waiter", "unit-b", "INVITATION_SCOPE_DENIED"],
      ["finance", "unit-a", "INVITATION_ROLE_DENIED"],
    ] as const) {
      await assert.rejects(
        () =>
          managerService.invite("manager", "organization", {
            email: "manager@example.test",
            role,
            unitId,
          }),
        (error) => errorCode(error) === expectedCode,
      );
    }
  } finally {
    if (previousEmailProvider === undefined) delete process.env.EMAIL_PROVIDER_ENABLED;
    else process.env.EMAIL_PROVIDER_ENABLED = previousEmailProvider;
  }
});

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

it("limits invitations to the inviter's unit and rechecks that authority on acceptance", async (context) => {
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("PILOT_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const previousEmailProvider = process.env.EMAIL_PROVIDER_ENABLED;
  const previousEncryptionKey = process.env.OUTBOX_ENCRYPTION_KEY;
  process.env.EMAIL_PROVIDER_ENABLED = "true";
  process.env.OUTBOX_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const database = new DatabaseService();
  try {
    const suffix = randomUUID();
    const organizationService = new OrganizationsService(database, new ScopeService(database));
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "Invitation scope integration",
        tradeName: "Invitation scope integration",
        document: suffix.replaceAll("-", "").slice(0, 14),
        billingState: "active",
      })
      .returning();
    assert.ok(organization);
    const [unitA, unitB] = await database.db
      .insert(units)
      .values([
        { organizationId: organization.id, name: "Unidade A" },
        { organizationId: organization.id, name: "Unidade B" },
      ])
      .returning();
    assert.ok(unitA && unitB);
    const [owner, manager, invitee] = await database.db
      .insert(identities)
      .values([
        { email: `owner-scope-${suffix}@example.test`, displayName: "Proprietário" },
        { email: `manager-scope-${suffix}@example.test`, displayName: "Gerente A" },
        { email: `invitee-scope-${suffix}@example.test`, displayName: "Convidado" },
      ])
      .returning();
    assert.ok(owner && manager && invitee);
    const [ownerMembership, managerMembership] = await database.db
      .insert(memberships)
      .values([
        { identityId: owner.id, organizationId: organization.id, status: "active" },
        { identityId: manager.id, organizationId: organization.id, status: "active" },
      ])
      .returning();
    assert.ok(ownerMembership && managerMembership);
    await database.db.insert(roleBindings).values([
      { membershipId: ownerMembership.id, role: "owner", unitId: null },
      { membershipId: managerMembership.id, role: "manager", unitId: unitA.id },
    ]);

    for (const [role, unitId, expectedCode] of [
      ["manager", null, "INVITATION_SCOPE_DENIED"],
      ["waiter", unitB.id, "INVITATION_SCOPE_DENIED"],
      ["manager", unitA.id, "INVITATION_ROLE_DENIED"],
      ["finance", unitA.id, "INVITATION_ROLE_DENIED"],
      ["owner", unitA.id, "OWNER_INVITE_REQUIRES_OWNER"],
    ] as const) {
      await assert.rejects(
        () =>
          organizationService.invite(manager.id, organization.id, {
            email: manager.email,
            role,
            unitId,
          }),
        (error) => errorCode(error) === expectedCode,
      );
    }

    for (const unitId of [null, unitB.id]) {
      const legacyToken = randomBytes(32).toString("base64url");
      const [legacyInvitation] = await database.db
        .insert(membershipInvitations)
        .values({
          organizationId: organization.id,
          unitId,
          email: manager.email,
          role: "waiter",
          tokenHash: createHash("sha256").update(legacyToken).digest("hex"),
          invitedByIdentityId: manager.id,
          expiresAt: new Date(Date.now() + 60_000),
        })
        .returning();
      assert.ok(legacyInvitation);
      await assert.rejects(
        () => organizationService.acceptInvite(manager.id, { token: legacyToken }),
        (error) => errorCode(error) === "INVITATION_SCOPE_DENIED",
      );
      const [unchanged] = await database.db
        .select({ acceptedAt: membershipInvitations.acceptedAt })
        .from(membershipInvitations)
        .where(eq(membershipInvitations.id, legacyInvitation.id));
      assert.equal(unchanged?.acceptedAt, null);
    }

    const allowed = await organizationService.invite(manager.id, organization.id, {
      email: manager.email,
      role: "waiter",
      unitId: unitA.id,
    });
    const [sent] = await database.db
      .select({ payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, allowed.id))
      .limit(1);
    assert.ok(sent);
    const token = decryptSecret(
      sent.payload.invitationTokenEnvelope as Parameters<typeof decryptSecret>[0],
      encryptionKey(process.env.OUTBOX_ENCRYPTION_KEY, "OUTBOX_ENCRYPTION_KEY"),
      `membership-invitation:${allowed.id}`,
    );
    await organizationService.acceptInvite(manager.id, { token });
    const bindings = await database.db
      .select({ role: roleBindings.role, unitId: roleBindings.unitId })
      .from(roleBindings)
      .where(eq(roleBindings.membershipId, managerMembership.id));
    assert.deepEqual(bindings.map(({ role, unitId }) => [role, unitId]).sort(), [
      ["manager", unitA.id],
      ["waiter", unitA.id],
    ]);

    const pending = await organizationService.invite(manager.id, organization.id, {
      email: invitee.email,
      role: "waiter",
      unitId: unitA.id,
    });
    const [pendingEvent] = await database.db
      .select({ payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, pending.id))
      .limit(1);
    assert.ok(pendingEvent);
    const pendingToken = decryptSecret(
      pendingEvent.payload.invitationTokenEnvelope as Parameters<typeof decryptSecret>[0],
      encryptionKey(process.env.OUTBOX_ENCRYPTION_KEY, "OUTBOX_ENCRYPTION_KEY"),
      `membership-invitation:${pending.id}`,
    );
    await database.db
      .delete(roleBindings)
      .where(eq(roleBindings.membershipId, managerMembership.id));
    await assert.rejects(
      () => organizationService.acceptInvite(invitee.id, { token: pendingToken }),
      (error) => errorCode(error) === "INVITATION_SCOPE_DENIED",
    );
    const [unchanged] = await database.db
      .select({ acceptedAt: membershipInvitations.acceptedAt })
      .from(membershipInvitations)
      .where(eq(membershipInvitations.id, pending.id));
    assert.equal(unchanged?.acceptedAt, null);

    const global = await organizationService.invite(owner.id, organization.id, {
      email: invitee.email,
      role: "manager",
      unitId: null,
    });
    const [globalEvent] = await database.db
      .select({ payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, global.id))
      .limit(1);
    assert.ok(globalEvent);
    const globalToken = decryptSecret(
      globalEvent.payload.invitationTokenEnvelope as Parameters<typeof decryptSecret>[0],
      encryptionKey(process.env.OUTBOX_ENCRYPTION_KEY, "OUTBOX_ENCRYPTION_KEY"),
      `membership-invitation:${global.id}`,
    );
    const acceptedGlobal = await organizationService.acceptInvite(invitee.id, {
      token: globalToken,
    });
    const [globalBinding] = await database.db
      .select({ role: roleBindings.role, unitId: roleBindings.unitId })
      .from(roleBindings)
      .where(eq(roleBindings.membershipId, acceptedGlobal.membershipId));
    assert.deepEqual(globalBinding, { role: "manager", unitId: null });
  } finally {
    if (previousEmailProvider === undefined) delete process.env.EMAIL_PROVIDER_ENABLED;
    else process.env.EMAIL_PROVIDER_ENABLED = previousEmailProvider;
    if (previousEncryptionKey === undefined) delete process.env.OUTBOX_ENCRYPTION_KEY;
    else process.env.OUTBOX_ENCRYPTION_KEY = previousEncryptionKey;
    await database.onModuleDestroy();
  }
});
