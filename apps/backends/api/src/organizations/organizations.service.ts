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
  managementPeople,
  managementPersonAccess,
  membershipInvitations,
  memberships,
  onboardingRecords,
  organizations,
  outboxEvents,
  posCatalogBranding,
  posPaymentDeviceCredentials,
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
import { smartPosInstallationLockKey } from "../pilot-operations/pilot-smartpos.service.js";
import { projectBrandingSummary } from "./establishment-settings.service.js";
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
    const [bindingRows, rawUnitRows, brandingRows] = await Promise.all([
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
      this.database.db
        .select({
          organizationId: posCatalogBranding.organizationId,
          unitId: posCatalogBranding.unitId,
          config: posCatalogBranding.config,
        })
        .from(posCatalogBranding)
        .where(inArray(posCatalogBranding.organizationId, organizationIds)),
    ]);
    const unitRows = rawUnitRows.map((unit) => ({
      ...unit,
      branding: projectBrandingSummary(
        brandingRows.find(
          (branding) =>
            branding.organizationId === unit.organizationId && branding.unitId === unit.id,
        )?.config,
        membershipRows.find((row) => row.organization.id === unit.organizationId)?.organization
          .tradeName ?? unit.name,
      ),
    }));
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
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${smartPosInstallationLockKey(organizationId, unitId, deviceId)}))`,
      );
      const revokedAt = new Date();
      const [device] = await tx
        .update(deviceEnrollments)
        .set({ revokedAt })
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
      const revokedCredentials = await tx
        .update(posPaymentDeviceCredentials)
        .set({ revokedAt })
        .where(
          and(
            eq(posPaymentDeviceCredentials.organizationId, organizationId),
            eq(posPaymentDeviceCredentials.unitId, unitId),
            eq(posPaymentDeviceCredentials.installationId, deviceId),
            isNull(posPaymentDeviceCredentials.revokedAt),
          ),
        )
        .returning({ id: posPaymentDeviceCredentials.id });
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "device.revoked",
        entityType: "device",
        entityId: device.id,
        metadata: { smartPosCredentialsRevoked: revokedCredentials.length },
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
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`membership-invitation:${hashToken(input.token)}`}::text, 0))`,
      );
      const [invitation] = await tx
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
      await tx.execute(
        sql`select person_id from management_person_access where invitation_id=${invitation.id}::uuid for update`,
      );
      const [personAccess] = await tx
        .select()
        .from(managementPersonAccess)
        .where(eq(managementPersonAccess.invitationId, invitation.id))
        .limit(1);
      if (personAccess) {
        const [person] = await tx
          .select({ id: managementPeople.id, active: managementPeople.active })
          .from(managementPeople)
          .where(
            and(
              eq(managementPeople.organizationId, personAccess.organizationId),
              eq(managementPeople.unitId, personAccess.unitId),
              eq(managementPeople.id, personAccess.personId),
            ),
          )
          .limit(1);
        if (
          !person?.active ||
          personAccess.status !== "pending" ||
          personAccess.organizationId !== invitation.organizationId ||
          personAccess.unitId !== invitation.unitId
        ) {
          throw new BadRequestException({ code: "INVALID_INVITATION" });
        }
        const [linkedElsewhere] = await tx
          .select({ id: managementPeople.id })
          .from(managementPeople)
          .where(
            and(
              eq(managementPeople.organizationId, personAccess.organizationId),
              eq(managementPeople.unitId, personAccess.unitId),
              eq(managementPeople.identityId, identityId),
            ),
          )
          .limit(1);
        if (linkedElsewhere && linkedElsewhere.id !== personAccess.personId) {
          throw new ConflictException({ code: "PERSON_IDENTITY_ALREADY_LINKED" });
        }
      }
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
      const role = personAccess?.role ?? invitation.role;
      const [createdBinding] = await tx
        .insert(roleBindings)
        .values({ membershipId: membership.id, unitId: invitation.unitId, role })
        .onConflictDoNothing()
        .returning({ id: roleBindings.id });
      const [roleBinding] = createdBinding
        ? [createdBinding]
        : await tx
            .select({ id: roleBindings.id })
            .from(roleBindings)
            .where(
              and(
                eq(roleBindings.membershipId, membership.id),
                invitation.unitId === null
                  ? isNull(roleBindings.unitId)
                  : eq(roleBindings.unitId, invitation.unitId),
                eq(roleBindings.role, role),
              ),
            )
            .limit(1);
      if (!roleBinding) throw new Error("Role binding was not activated");
      await tx
        .update(membershipInvitations)
        .set({ acceptedAt: new Date() })
        .where(eq(membershipInvitations.id, invitation.id));
      if (personAccess) {
        const changedAt = new Date();
        await tx
          .update(managementPeople)
          .set({ identityId, updatedByIdentityId: identityId, updatedAt: changedAt })
          .where(eq(managementPeople.id, personAccess.personId));
        await tx
          .update(managementPersonAccess)
          .set({
            status: "active",
            membershipId: membership.id,
            roleBindingId: roleBinding.id,
            statusChangedAt: changedAt,
            statusChangedByIdentityId: identityId,
            statusChangeReason: "Convite aceito.",
            updatedAt: changedAt,
          })
          .where(eq(managementPersonAccess.invitationId, invitation.id));
        await tx.insert(auditEvents).values({
          organizationId: invitation.organizationId,
          unitId: invitation.unitId,
          actorIdentityId: identityId,
          action: "management.person.access.accepted",
          entityType: "person_access",
          entityId: personAccess.personId,
          metadata: { membershipId: membership.id, role },
        });
        await tx.insert(outboxEvents).values({
          topic: "management.person.access.accepted",
          aggregateType: "person_access",
          aggregateId: personAccess.personId,
          payload: {
            organizationId: invitation.organizationId,
            unitId: invitation.unitId,
            identityId,
            membershipId: membership.id,
            role,
          },
        });
      }
      await tx.insert(auditEvents).values({
        organizationId: invitation.organizationId,
        unitId: invitation.unitId,
        actorIdentityId: identityId,
        action: "membership.accepted",
        entityType: "membership",
        entityId: membership.id,
      });
      return {
        membershipId: membership.id,
        organizationId: invitation.organizationId,
        personId: personAccess?.personId,
      };
    });
  }
}
