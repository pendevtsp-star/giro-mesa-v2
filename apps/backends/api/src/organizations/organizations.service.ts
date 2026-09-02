import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type {
  AcceptMembershipInviteInput,
  CreateOrganizationInput,
  EdgeHubPairingCreateInput,
  EdgeHubPairingRedeemInput,
  EdgeHubPilotFeedbackInput,
  EnrollDeviceInput,
  InviteMembershipInput,
  SelfServiceOrganizationInput,
} from "@giromesa/contracts";
import {
  auditEvents,
  commercialCatalogVersions,
  commercialPlans,
  deviceEnrollments,
  edgeHubPairingCodes,
  identities,
  legalEntities,
  managementPeople,
  managementPersonAccess,
  managementPersonRoleAssignments,
  membershipInvitations,
  memberships,
  onboardingRecords,
  organizations,
  outboxEvents,
  posCatalogBranding,
  posPaymentDeviceCredentials,
  roleBindings,
  trials,
  units,
} from "@giromesa/db";
import { encryptionKey, encryptSecret, trialWindow } from "@giromesa/domain";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { smartPosInstallationLockKey } from "../pilot-operations/pilot-smartpos.service.js";
import { edgeHubInstallerConfig, publicEdgeHubInstaller } from "./edge-hub-installer-config.js";
import { projectBrandingSummary } from "./establishment-settings.service.js";
import { shapeOrganizationScopes } from "./organization-scopes.js";
import { ScopeService } from "./scope.service.js";

const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");
const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function pairingCode() {
  return [...randomBytes(8)].map((byte) => PAIRING_ALPHABET[byte & 31]).join("");
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

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

  async createSelfService(identityId: string, input: SelfServiceOrganizationInput) {
    const [plan] = await this.database.db
      .select({ id: commercialPlans.id, slug: commercialPlans.slug })
      .from(commercialPlans)
      .innerJoin(
        commercialCatalogVersions,
        eq(commercialCatalogVersions.id, commercialPlans.catalogVersionId),
      )
      .where(
        and(
          eq(commercialPlans.slug, input.planSlug),
          eq(commercialCatalogVersions.status, "published"),
        ),
      )
      .orderBy(desc(commercialCatalogVersions.version))
      .limit(1);
    if (!plan)
      throw new BadRequestException({
        code: "PLAN_NOT_AVAILABLE",
        message: "Plano selecionado indisponível.",
      });

    const { planSlug: _planSlug, ...organizationInput } = input;
    try {
      return await this.database.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`self-service:${identityId}:${input.document}`}::text, 0))`,
        );
        const [existing] = await tx
          .select({ organization: organizations, unit: units, membershipId: memberships.id })
          .from(memberships)
          .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
          .innerJoin(units, eq(units.organizationId, organizations.id))
          .where(
            and(
              eq(memberships.identityId, identityId),
              eq(memberships.status, "active"),
              eq(organizations.document, input.document),
            ),
          )
          .limit(1);
        if (existing) {
          const [trial] = await tx
            .select()
            .from(trials)
            .where(eq(trials.organizationId, existing.organization.id))
            .limit(1);
          if (!trial)
            throw new ConflictException({
              code: "ORGANIZATION_EXISTS",
              message: "Já existe uma organização com este CNPJ.",
            });
          return {
            organization: existing.organization,
            unit: existing.unit,
            trial,
            membershipId: existing.membershipId,
            replayed: true,
          };
        }
        const [conflict] = await tx
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.document, input.document))
          .limit(1);
        if (conflict)
          throw new ConflictException({
            code: "ORGANIZATION_EXISTS",
            message: "Já existe uma organização com este CNPJ.",
          });

        const now = new Date();
        const window = trialWindow(now);
        const [organization] = await tx
          .insert(organizations)
          .values({ ...organizationInput, billingState: "trial_active" })
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
        await tx.insert(onboardingRecords).values({
          organizationId: organization.id,
          checklist: { business: true, unit: true },
          activatedAt: now,
          activatedByIdentityId: identityId,
        });
        const [trial] = await tx
          .insert(trials)
          .values({
            organizationId: organization.id,
            commercialPlanId: plan.id,
            ...window,
            activatedByIdentityId: identityId,
          })
          .returning();
        if (!trial) throw new Error("Trial was not created");
        await tx.insert(auditEvents).values({
          organizationId: organization.id,
          unitId: unit.id,
          actorIdentityId: identityId,
          action: "trial.activated",
          entityType: "trial",
          entityId: trial.id,
          metadata: {
            planSlug: plan.slug,
            selfService: true,
            endsAt: window.endsAt.toISOString(),
          },
        });
        await tx.insert(outboxEvents).values({
          topic: "trial.activated",
          aggregateType: "trial",
          aggregateId: trial.id,
          payload: {
            organizationId: organization.id,
            trialId: trial.id,
            endsAt: window.endsAt.toISOString(),
          },
        });
        return { organization, unit, trial, membershipId: membership.id, replayed: false };
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
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

  async createEdgeHubPairing(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: EdgeHubPairingCreateInput,
  ) {
    const roles = await this.scope.requireOrganizationRole(identityId, organizationId, [
      "owner",
      "manager",
    ]);
    if (!roles.some((row) => row.unitId === null || row.unitId === unitId)) {
      throw new NotFoundException();
    }
    const code = pairingCode();
    const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1_000);
    const installer = edgeHubInstallerConfig(organizationId);
    return this.database.db.transaction(async (tx) => {
      const [pairing] = await tx
        .insert(edgeHubPairingCodes)
        .values({
          organizationId,
          unitId,
          label: input.label,
          codeHash: hashToken(code),
          createdByIdentityId: identityId,
          expiresAt,
        })
        .returning({ id: edgeHubPairingCodes.id });
      if (!pairing) throw new Error("Edge Hub pairing insert did not return a row");
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "device.edge_hub_pairing_created",
        entityType: "device_pairing",
        entityId: pairing.id,
        metadata: { label: input.label, expiresAt },
      });
      return {
        pairingId: pairing.id,
        code,
        expiresAt,
        installerUrl: installer?.publicUrl ?? null,
        installer: installer ? publicEdgeHubInstaller(installer) : null,
      };
    });
  }

  async prepareEdgeHubInstallerDownload(
    identityId: string,
    organizationId: string,
    unitId: string,
    pairingId: string,
  ) {
    const roles = await this.scope.requireOrganizationRole(identityId, organizationId, [
      "owner",
      "manager",
    ]);
    if (!roles.some((row) => row.unitId === null || row.unitId === unitId)) {
      throw new NotFoundException();
    }

    const installer = edgeHubInstallerConfig(organizationId);
    if (!installer?.filePath) {
      throw new NotFoundException({
        code: "EDGE_HUB_INSTALLER_NOT_AVAILABLE",
        message: "O instalador ainda não está disponível para esta unidade.",
      });
    }
    const [pairing] = await this.database.db
      .select({ id: edgeHubPairingCodes.id })
      .from(edgeHubPairingCodes)
      .where(
        and(
          eq(edgeHubPairingCodes.id, pairingId),
          eq(edgeHubPairingCodes.organizationId, organizationId),
          eq(edgeHubPairingCodes.unitId, unitId),
          gt(edgeHubPairingCodes.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!pairing) {
      throw new ConflictException({
        code: "EDGE_HUB_PAIRING_INVALID_OR_EXPIRED",
        message: "Gere um novo código de conexão antes de baixar o instalador.",
      });
    }

    let file: Awaited<ReturnType<typeof stat>>;
    try {
      file = await stat(installer.filePath);
    } catch {
      throw new ServiceUnavailableException({
        code: "EDGE_HUB_INSTALLER_FILE_UNAVAILABLE",
        message: "O arquivo do instalador não está disponível no momento.",
      });
    }
    if (!file.isFile() || file.size < 1 || file.size > 256 * 1024 * 1024) {
      throw new ServiceUnavailableException({ code: "EDGE_HUB_INSTALLER_FILE_INVALID" });
    }
    if ((await sha256File(installer.filePath)) !== installer.sha256) {
      throw new ServiceUnavailableException({
        code: "EDGE_HUB_INSTALLER_INTEGRITY_FAILED",
        message: "A verificação de segurança do instalador falhou.",
      });
    }

    await this.database.db.insert(auditEvents).values({
      organizationId,
      unitId,
      actorIdentityId: identityId,
      action: "device.edge_hub_installer_downloaded",
      entityType: "device_pairing",
      entityId: pairing.id,
      metadata: {
        channel: installer.channel,
        sha256: installer.sha256,
        version: installer.version,
      },
    });
    return {
      channel: installer.channel,
      filePath: installer.filePath,
      filename:
        installer.channel === "pilot"
          ? "GiroMesa-Conector-Setup-PILOTO.exe"
          : "GiroMesa-Conector-Setup.exe",
      sha256: installer.sha256,
      size: file.size,
      version: installer.version,
    };
  }

  async recordEdgeHubPilotFeedback(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: EdgeHubPilotFeedbackInput,
  ) {
    const roles = await this.scope.requireOrganizationRole(identityId, organizationId, [
      "owner",
      "manager",
    ]);
    if (!roles.some((row) => row.unitId === null || row.unitId === unitId)) {
      throw new NotFoundException();
    }
    const [device] = await this.database.db
      .select({ id: deviceEnrollments.id })
      .from(deviceEnrollments)
      .where(
        and(
          eq(deviceEnrollments.id, input.deviceId),
          eq(deviceEnrollments.organizationId, organizationId),
          eq(deviceEnrollments.unitId, unitId),
          isNull(deviceEnrollments.revokedAt),
        ),
      )
      .limit(1);
    if (!device) throw new NotFoundException();

    await this.database.db.insert(auditEvents).values({
      organizationId,
      unitId,
      actorIdentityId: identityId,
      action: "device.edge_hub_pilot_feedback",
      entityType: "device",
      entityId: device.id,
      metadata: {
        experience: input.experience,
        ...(input.comment ? { comment: input.comment } : {}),
      },
    });
    return { accepted: true as const };
  }

  async redeemEdgeHubPairing(input: EdgeHubPairingRedeemInput) {
    const hash = hashToken(input.code.trim().toUpperCase());
    return this.database.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`edge-hub-pair:${hash}`}))`);
      const [pairing] = await tx
        .select()
        .from(edgeHubPairingCodes)
        .where(
          and(
            eq(edgeHubPairingCodes.codeHash, hash),
            isNull(edgeHubPairingCodes.consumedAt),
            gt(edgeHubPairingCodes.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!pairing) throw new ConflictException({ code: "EDGE_HUB_PAIRING_INVALID_OR_EXPIRED" });

      const syncKey = randomBytes(32).toString("base64url");
      const [device] = await tx
        .insert(deviceEnrollments)
        .values({
          organizationId: pairing.organizationId,
          unitId: pairing.unitId,
          label: pairing.label,
          syncKeyHash: hashToken(syncKey),
        })
        .returning({ id: deviceEnrollments.id });
      if (!device) throw new Error("Edge Hub enrollment did not return a row");

      const now = new Date();
      const [consumed] = await tx
        .update(edgeHubPairingCodes)
        .set({ consumedAt: now, consumedByDeviceId: device.id })
        .where(and(eq(edgeHubPairingCodes.id, pairing.id), isNull(edgeHubPairingCodes.consumedAt)))
        .returning({ id: edgeHubPairingCodes.id });
      if (!consumed) throw new ConflictException({ code: "EDGE_HUB_PAIRING_ALREADY_USED" });

      await tx.insert(auditEvents).values({
        organizationId: pairing.organizationId,
        unitId: pairing.unitId,
        actorIdentityId: pairing.createdByIdentityId,
        action: "device.enrolled",
        entityType: "device",
        entityId: device.id,
        metadata: { pairingId: pairing.id, enrollment: "edge_hub_installer" },
      });
      return {
        deviceId: device.id,
        organizationId: pairing.organizationId,
        unitId: pairing.unitId,
        syncKey,
      };
    });
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
      if (invitation.email !== identity.email) {
        throw new ConflictException({
          code: "INVITATION_ACCOUNT_MISMATCH",
          message: "Entre com a conta do e-mail que recebeu o convite.",
        });
      }
      let [personAccess] = await tx
        .select()
        .from(managementPersonAccess)
        .where(eq(managementPersonAccess.invitationId, invitation.id))
        .limit(1);
      if (personAccess) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`person-access:${personAccess.organizationId}:${personAccess.personId}`}, 0))`,
        );
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`person-access:${personAccess.organizationId}:${personAccess.unitId}:${personAccess.personId}`}, 0))`,
        );
        await tx.execute(
          sql`select person_id from management_person_access where invitation_id=${invitation.id}::uuid for update`,
        );
        [personAccess] = await tx
          .select()
          .from(managementPersonAccess)
          .where(eq(managementPersonAccess.invitationId, invitation.id))
          .limit(1);
        if (!personAccess) throw new BadRequestException({ code: "INVALID_INVITATION" });
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
      } else if (invitation.unitId) {
        const [linkedPerson] = await tx
          .select({ id: managementPeople.id })
          .from(managementPeople)
          .where(
            and(
              eq(managementPeople.organizationId, invitation.organizationId),
              eq(managementPeople.identityId, identityId),
            ),
          )
          .limit(1);
        if (linkedPerson) {
          throw new ConflictException({ code: "PERSON_ROLE_ASSIGNMENT_REQUIRED" });
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
      const assignments = personAccess
        ? await tx
            .select()
            .from(managementPersonRoleAssignments)
            .where(
              and(
                eq(managementPersonRoleAssignments.organizationId, personAccess.organizationId),
                eq(managementPersonRoleAssignments.unitId, personAccess.unitId),
                eq(managementPersonRoleAssignments.personId, personAccess.personId),
              ),
            )
        : [];
      if (
        personAccess &&
        (!assignments.length ||
          !assignments.some((assignment) => assignment.role === personAccess.role) ||
          assignments.some((assignment) => assignment.roleBindingId))
      ) {
        throw new ConflictException({ code: "PERSON_ROLE_ASSIGNMENT_REQUIRED" });
      }
      const roles = personAccess
        ? [
            personAccess.role,
            ...assignments
              .map((assignment) => assignment.role)
              .filter((role) => role !== personAccess.role)
              .sort(),
          ]
        : [invitation.role];
      if (personAccess) {
        const [orphanBinding] = await tx
          .select({ id: roleBindings.id })
          .from(roleBindings)
          .where(
            and(
              eq(roleBindings.membershipId, membership.id),
              eq(roleBindings.unitId, personAccess.unitId),
            ),
          )
          .limit(1);
        if (orphanBinding) {
          throw new ConflictException({ code: "PERSON_ROLE_ASSIGNMENT_REQUIRED" });
        }
      }
      const activatedBindings: Array<{ id: string; role: (typeof roles)[number] }> = [];
      for (const role of roles) {
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
        activatedBindings.push({ ...roleBinding, role });
      }
      await tx
        .update(membershipInvitations)
        .set({ acceptedAt: new Date() })
        .where(eq(membershipInvitations.id, invitation.id));
      if (personAccess) {
        const changedAt = new Date();
        const [primaryBinding] = activatedBindings;
        if (!primaryBinding) throw new Error("Role binding was not activated");
        for (const binding of activatedBindings) {
          const [updatedAssignment] = await tx
            .update(managementPersonRoleAssignments)
            .set({ roleBindingId: binding.id, updatedAt: changedAt })
            .where(
              and(
                eq(managementPersonRoleAssignments.organizationId, personAccess.organizationId),
                eq(managementPersonRoleAssignments.unitId, personAccess.unitId),
                eq(managementPersonRoleAssignments.personId, personAccess.personId),
                eq(managementPersonRoleAssignments.role, binding.role),
              ),
            )
            .returning({ id: managementPersonRoleAssignments.id });
          if (!updatedAssignment) {
            throw new ConflictException({ code: "PERSON_ROLE_ASSIGNMENT_REQUIRED" });
          }
        }
        await tx
          .update(managementPeople)
          .set({ identityId, updatedByIdentityId: identityId, updatedAt: changedAt })
          .where(eq(managementPeople.id, personAccess.personId));
        await tx
          .update(managementPersonAccess)
          .set({
            status: "active",
            membershipId: membership.id,
            roleBindingId: primaryBinding.id,
            statusChangedAt: changedAt,
            statusChangedByIdentityId: identityId,
            statusChangeReason: "Convite aceito.",
            updatedAt: changedAt,
            revision: sql`${managementPersonAccess.revision} + 1`,
          })
          .where(eq(managementPersonAccess.invitationId, invitation.id));
        await tx.insert(auditEvents).values({
          organizationId: invitation.organizationId,
          unitId: invitation.unitId,
          actorIdentityId: identityId,
          action: "management.person.access.accepted",
          entityType: "person_access",
          entityId: personAccess.personId,
          metadata: { membershipId: membership.id, roles },
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
            roles,
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
