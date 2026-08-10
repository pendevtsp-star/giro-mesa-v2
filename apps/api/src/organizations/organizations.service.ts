import { createHash, randomBytes } from "node:crypto";
import type {
  AcceptMembershipInviteInput,
  CreateOrganizationInput,
  EnrollDeviceInput,
  InviteMembershipInput,
} from "@giromesa/contracts";
import {
  auditEvents,
  deviceEnrollments,
  identities,
  legalEntities,
  membershipInvitations,
  memberships,
  onboardingRecords,
  organizations,
  outboxEvents,
  roleBindings,
  units,
} from "@giromesa/db";
import { encryptionKey, encryptSecret } from "@giromesa/domain";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { shapeOrganizationScopes } from "./organization-scopes.js";
import { ScopeService } from "./scope.service.js";

const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
  ) {}

  async create(identityId: string, input: CreateOrganizationInput) {
    try {
      return await this.database.db.transaction(async (tx) => {
        const [organization] = await tx
          .insert(organizations)
          .values({ ...input, billingState: "onboarding" })
          .returning();
        if (!organization) throw new Error("Organization was not created");
        await tx.execute(
          sql`select set_config('app.bootstrap_organization_id', ${organization.id}, true)`,
        );
        const [legalEntity] = await tx
          .insert(legalEntities)
          .values({
            organizationId: organization.id,
            legalName: input.legalName,
            document: input.document,
          })
          .returning();
        if (!legalEntity) throw new Error("Legal entity was not created");
        const [unit] = await tx
          .insert(units)
          .values({
            organizationId: organization.id,
            legalEntityId: legalEntity.id,
            name: input.unitName,
            timezone: input.timezone,
          })
          .returning();
        if (!unit) throw new Error("Unit was not created");
        const [membership] = await tx
          .insert(memberships)
          .values({ identityId, organizationId: organization.id, status: "active" })
          .returning();
        if (!membership) throw new Error("Membership was not created");
        await tx
          .insert(roleBindings)
          .values({ membershipId: membership.id, unitId: null, role: "owner" });
        await tx.insert(onboardingRecords).values({ organizationId: organization.id });
        await tx.insert(auditEvents).values({
          organizationId: organization.id,
          unitId: unit.id,
          actorIdentityId: identityId,
          action: "organization.created",
          entityType: "organization",
          entityId: organization.id,
        });
        await tx.insert(outboxEvents).values({
          organizationId: organization.id,
          unitId: unit.id,
          topic: "organization.created",
          aggregateType: "organization",
          aggregateId: organization.id,
          payload: { organizationId: organization.id, unitId: unit.id },
        });
        return { organization, unit };
      });
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "23505") {
        throw new ConflictException({
          code: "ORGANIZATION_EXISTS",
          message: "Já existe uma organização com este CNPJ.",
        });
      }
      throw error;
    }
  }

  async list(identityId: string) {
    const membershipRows = await this.database.db
      .select({
        membershipId: memberships.id,
        status: memberships.status,
        organization: {
          id: organizations.id,
          legalName: organizations.legalName,
          tradeName: organizations.tradeName,
          billingState: organizations.billingState,
        },
      })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(and(eq(memberships.identityId, identityId), eq(memberships.status, "active")));
    if (membershipRows.length === 0) return [];

    const membershipIds = membershipRows.map((row) => row.membershipId);
    const organizationIds = membershipRows.map((row) => row.organization.id);
    const [bindingRows, unitRows] = await Promise.all([
      this.database.db
        .select({
          membershipId: roleBindings.membershipId,
          unitId: roleBindings.unitId,
          role: roleBindings.role,
        })
        .from(roleBindings)
        .where(inArray(roleBindings.membershipId, membershipIds)),
      this.database.db
        .select({
          id: units.id,
          organizationId: units.organizationId,
          name: units.name,
          timezone: units.timezone,
          active: units.active,
        })
        .from(units)
        .where(and(inArray(units.organizationId, organizationIds), eq(units.active, true))),
    ]);
    return shapeOrganizationScopes(membershipRows, bindingRows, unitRows);
  }

  async enrollDevice(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: EnrollDeviceInput,
  ) {
    const roles = await this.scope.requireOrganizationRole(identityId, organizationId, [
      "owner",
      "manager",
    ]);
    if (!roles.some((row) => row.unitId === null || row.unitId === unitId))
      throw new NotFoundException();
    const syncKey = randomBytes(32).toString("base64url");
    const device = await this.database.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(deviceEnrollments)
        .values({ organizationId, unitId, ...input, syncKeyHash: hashToken(syncKey) })
        .returning({
          id: deviceEnrollments.id,
          organizationId: deviceEnrollments.organizationId,
          unitId: deviceEnrollments.unitId,
          label: deviceEnrollments.label,
          certificateFingerprint: deviceEnrollments.certificateFingerprint,
          enrolledAt: deviceEnrollments.enrolledAt,
          revokedAt: deviceEnrollments.revokedAt,
        });
      if (!created) throw new Error("Device was not enrolled");
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "device.enrolled",
        entityType: "device",
        entityId: created.id,
      });
      return created;
    });
    return { ...device, syncKey };
  }

  async revokeDevice(identityId: string, organizationId: string, unitId: string, deviceId: string) {
    const roles = await this.scope.requireOrganizationRole(identityId, organizationId, [
      "owner",
      "manager",
    ]);
    if (!roles.some((row) => row.unitId === null || row.unitId === unitId)) {
      throw new NotFoundException();
    }
    return this.database.db.transaction(async (tx) => {
      const [device] = await tx
        .update(deviceEnrollments)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(deviceEnrollments.id, deviceId),
            eq(deviceEnrollments.organizationId, organizationId),
            eq(deviceEnrollments.unitId, unitId),
            isNull(deviceEnrollments.revokedAt),
          ),
        )
        .returning({ id: deviceEnrollments.id });
      if (!device) throw new NotFoundException();
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "device.revoked",
        entityType: "device",
        entityId: device.id,
      });
    });
  }

  async invite(identityId: string, organizationId: string, input: InviteMembershipInput) {
    if (process.env.EMAIL_PROVIDER_ENABLED !== "true") {
      throw new ServiceUnavailableException({
        code: "EMAIL_PROVIDER_DISABLED",
        message: "Convites por e-mail ainda não foram configurados neste ambiente.",
      });
    }
    const inviterRoles = await this.scope.requireOrganizationRole(identityId, organizationId, [
      "owner",
      "manager",
    ]);
    if (input.role === "owner" && !inviterRoles.some((row) => row.role === "owner"))
      throw new BadRequestException({
        code: "OWNER_INVITE_REQUIRES_OWNER",
        message: "Somente proprietários podem convidar outro proprietário.",
      });
    if (input.unitId) await this.scope.requireUnitAccess(identityId, organizationId, input.unitId);
    const token = randomBytes(32).toString("base64url");
    const encryption = encryptionKey(process.env.OUTBOX_ENCRYPTION_KEY, "OUTBOX_ENCRYPTION_KEY");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const [invitation] = await this.database.db
      .insert(membershipInvitations)
      .values({
        organizationId,
        email: input.email,
        role: input.role,
        unitId: input.unitId,
        tokenHash: hashToken(token),
        invitedByIdentityId: identityId,
        expiresAt,
      })
      .returning({ id: membershipInvitations.id });
    if (!invitation) throw new Error("Invitation was not created");
    await this.database.db.insert(outboxEvents).values({
      organizationId,
      unitId: input.unitId ?? null,
      topic: "membership.invited",
      aggregateType: "membership_invitation",
      aggregateId: invitation.id,
      payload: {
        email: input.email,
        invitationTokenEnvelope: encryptSecret(
          token,
          encryption,
          `membership-invitation:${invitation.id}`,
        ),
        expiresAt: expiresAt.toISOString(),
      },
    });
    await this.database.db.insert(auditEvents).values({
      organizationId,
      actorIdentityId: identityId,
      action: "membership.invited",
      entityType: "membership_invitation",
      entityId: invitation.id,
      metadata: { role: input.role, unitId: input.unitId },
    });
    return { id: invitation.id, expiresAt };
  }

  async acceptInvite(identityId: string, input: AcceptMembershipInviteInput) {
    const [identity] = await this.database.db
      .select({ email: identities.email })
      .from(identities)
      .where(eq(identities.id, identityId))
      .limit(1);
    if (!identity) throw new NotFoundException();
    const [invitation] = await this.database.db
      .select()
      .from(membershipInvitations)
      .where(
        and(
          eq(membershipInvitations.tokenHash, hashToken(input.token)),
          eq(membershipInvitations.email, identity.email),
          isNull(membershipInvitations.acceptedAt),
          gt(membershipInvitations.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!invitation)
      throw new BadRequestException({
        code: "INVALID_INVITATION",
        message: "Convite inválido, expirado ou destinado a outro e-mail.",
      });

    return this.database.db.transaction(async (tx) => {
      const [membership] = await tx
        .insert(memberships)
        .values({
          identityId,
          organizationId: invitation.organizationId,
          status: "active",
          invitedByIdentityId: invitation.invitedByIdentityId,
        })
        .onConflictDoUpdate({
          target: [memberships.identityId, memberships.organizationId],
          set: { status: "active", updatedAt: new Date() },
        })
        .returning();
      if (!membership) throw new Error("Membership was not activated");
      await tx
        .insert(roleBindings)
        .values({ membershipId: membership.id, unitId: invitation.unitId, role: invitation.role })
        .onConflictDoNothing();
      await tx
        .update(membershipInvitations)
        .set({ acceptedAt: new Date() })
        .where(eq(membershipInvitations.id, invitation.id));
      await tx.insert(auditEvents).values({
        organizationId: invitation.organizationId,
        unitId: invitation.unitId,
        actorIdentityId: identityId,
        action: "membership.accepted",
        entityType: "membership",
        entityId: membership.id,
      });
      return { membershipId: membership.id, organizationId: invitation.organizationId };
    });
  }
}
