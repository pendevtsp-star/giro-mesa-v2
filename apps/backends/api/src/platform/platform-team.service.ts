import { createHash, randomBytes } from "node:crypto";
import {
  auditEvents,
  identities,
  mfaFactors,
  outboxEvents,
  platformActionReceipts,
  platformStaffAccess,
  platformStaffInvitations,
} from "@giromesa/db";
import { encryptionKey, encryptSecret } from "@giromesa/domain";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { and, asc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { AuthService } from "../auth/auth.service.js";
import { DatabaseService } from "../database/database.module.js";
import type {
  PlatformStaffActionInput,
  PlatformStaffInvitationAcceptInput,
  PlatformStaffInviteInput,
} from "./platform.schemas.js";
import { platformAccessForEmail } from "./platform-access.js";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");

@Injectable()
export class PlatformTeamService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auth: AuthService,
  ) {}

  async list() {
    const [members, invitations] = await Promise.all([
      this.database.db
        .select({
          identityId: identities.id,
          email: identities.email,
          name: identities.displayName,
          role: platformStaffAccess.role,
          grantedAt: platformStaffAccess.createdAt,
          emailVerifiedAt: identities.emailVerifiedAt,
          mfaEnabled: sql<boolean>`exists (
            select 1 from mfa_factors
            where mfa_factors.identity_id = ${identities.id}
              and mfa_factors.verified_at is not null
          )`,
        })
        .from(platformStaffAccess)
        .innerJoin(identities, eq(identities.id, platformStaffAccess.identityId))
        .where(isNull(platformStaffAccess.revokedAt))
        .orderBy(asc(identities.email)),
      this.database.db
        .select({
          id: platformStaffInvitations.id,
          email: platformStaffInvitations.email,
          role: platformStaffInvitations.role,
          expiresAt: platformStaffInvitations.expiresAt,
          createdAt: platformStaffInvitations.createdAt,
        })
        .from(platformStaffInvitations)
        .where(
          and(
            isNull(platformStaffInvitations.acceptedAt),
            isNull(platformStaffInvitations.revokedAt),
          ),
        )
        .orderBy(asc(platformStaffInvitations.email)),
    ]);
    const now = new Date();
    return {
      members: members.map(({ emailVerifiedAt, ...member }) => ({
        ...member,
        emailVerified: Boolean(emailVerifiedAt),
      })),
      invitations: invitations.map((invitation) => ({
        ...invitation,
        status: invitation.expiresAt > now ? "pending" : "expired",
      })),
    };
  }

  async invite(actorIdentityId: string, idempotencyKey: string, input: PlatformStaffInviteInput) {
    const replay = await this.replay(
      actorIdentityId,
      idempotencyKey,
      "platform.team.invited",
      input.email,
      input.reason,
      input.role,
    );
    if (replay) return replay;
    if (process.env.EMAIL_PROVIDER_ENABLED !== "true") {
      throw new ServiceUnavailableException({
        code: "EMAIL_PROVIDER_DISABLED",
        message: "Configure o provedor de e-mail antes de enviar convites.",
      });
    }
    if (platformAccessForEmail(input.email)) {
      throw new ConflictException({
        code: "PLATFORM_STAFF_ALREADY_BOOTSTRAPPED",
        message: "Este e-mail já possui acesso configurado pelo ambiente.",
      });
    }
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`platform-action:${actorIdentityId}:${idempotencyKey}`}, 0))`,
      );
      const [receipt] = await tx
        .select()
        .from(platformActionReceipts)
        .where(
          and(
            eq(platformActionReceipts.actorIdentityId, actorIdentityId),
            eq(platformActionReceipts.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (receipt) {
        if (
          receipt.action !== "platform.team.invited" ||
          receipt.targetId !== input.email ||
          receipt.reason !== input.reason ||
          (receipt.result as Record<string, unknown>).role !== input.role
        ) {
          throw new ConflictException({ code: "PLATFORM_IDEMPOTENCY_KEY_REUSED" });
        }
        return { ...(receipt.result as Record<string, unknown>), replayed: true };
      }
      await this.auth.verifyStepUp(actorIdentityId, input.reauth);
      const token = randomBytes(32).toString("base64url");
      const tokenEnvelope = encryptSecret(
        token,
        encryptionKey(process.env.OUTBOX_ENCRYPTION_KEY, "OUTBOX_ENCRYPTION_KEY"),
        `platform-staff-invitation:${hashToken(token)}`,
      );
      const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`platform-staff:${input.email}`}, 0))`,
      );
      const [existingIdentity] = await tx
        .select({ id: identities.id })
        .from(identities)
        .innerJoin(platformStaffAccess, eq(platformStaffAccess.identityId, identities.id))
        .where(and(eq(identities.email, input.email), isNull(platformStaffAccess.revokedAt)))
        .limit(1);
      if (existingIdentity) {
        throw new ConflictException({
          code: "PLATFORM_STAFF_ACCESS_EXISTS",
          message: "Este e-mail já possui acesso ativo ao backoffice.",
        });
      }
      await tx
        .update(platformStaffInvitations)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(platformStaffInvitations.email, input.email),
            isNull(platformStaffInvitations.acceptedAt),
            isNull(platformStaffInvitations.revokedAt),
          ),
        );
      const [invitation] = await tx
        .insert(platformStaffInvitations)
        .values({
          email: input.email,
          role: input.role,
          tokenHash: hashToken(token),
          invitedByIdentityId: actorIdentityId,
          expiresAt,
        })
        .returning({ id: platformStaffInvitations.id });
      if (!invitation) throw new Error("Platform staff invitation was not created");
      await tx.insert(outboxEvents).values({
        topic: "platform.staff_invited",
        aggregateType: "platform_staff_invitation",
        aggregateId: invitation.id,
        payload: {
          email: input.email,
          invitationTokenEnvelope: tokenEnvelope,
          expiresAt: expiresAt.toISOString(),
        },
      });
      await tx.insert(auditEvents).values({
        actorIdentityId,
        action: "platform.team.invited",
        entityType: "platform_staff_invitation",
        entityId: invitation.id,
        metadata: { email: input.email, role: input.role, reason: input.reason },
      });
      const result = {
        id: invitation.id,
        role: input.role,
        expiresAt: expiresAt.toISOString(),
        replayed: false,
      };
      await tx.insert(platformActionReceipts).values({
        actorIdentityId,
        idempotencyKey,
        action: "platform.team.invited",
        targetType: "platform_staff_email",
        targetId: input.email,
        reason: input.reason,
        result,
      });
      return result;
    });
  }

  async accept(identityId: string, input: PlatformStaffInvitationAcceptInput) {
    const [identity] = await this.database.db
      .select({
        email: identities.email,
        emailVerifiedAt: identities.emailVerifiedAt,
        disabledAt: identities.disabledAt,
        kind: identities.kind,
      })
      .from(identities)
      .where(eq(identities.id, identityId))
      .limit(1);
    if (identity?.kind !== "human" || identity.disabledAt) throw new NotFoundException();
    const [factor] = await this.database.db
      .select({ identityId: mfaFactors.identityId })
      .from(mfaFactors)
      .where(and(eq(mfaFactors.identityId, identityId), isNotNull(mfaFactors.verifiedAt)))
      .limit(1);
    if (!factor) {
      throw new BadRequestException({
        code: "PLATFORM_INVITATION_MFA_REQUIRED",
        message: "Ative o MFA antes de aceitar o convite.",
      });
    }
    const tokenHash = hashToken(input.token);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`platform-staff:${identity.email}`}, 0))`,
      );
      const [invitation] = await tx
        .select()
        .from(platformStaffInvitations)
        .where(
          and(
            eq(platformStaffInvitations.tokenHash, tokenHash),
            eq(platformStaffInvitations.email, identity.email),
          ),
        )
        .limit(1);
      if (invitation?.acceptedAt && invitation.acceptedByIdentityId === identityId) {
        const [activeAccess] = await tx
          .select({ role: platformStaffAccess.role })
          .from(platformStaffAccess)
          .where(
            and(
              eq(platformStaffAccess.identityId, identityId),
              isNull(platformStaffAccess.revokedAt),
            ),
          )
          .limit(1);
        if (activeAccess?.role === invitation.role) {
          return {
            role: invitation.role,
            acceptedAt: invitation.acceptedAt.toISOString(),
            mfaRequired: true,
            replayed: true,
          };
        }
      }
      if (
        !invitation ||
        invitation.acceptedAt ||
        invitation.revokedAt ||
        invitation.expiresAt <= new Date()
      ) {
        throw new BadRequestException({
          code: "INVALID_PLATFORM_INVITATION",
          message: "Convite inválido, expirado ou destinado a outro e-mail.",
        });
      }
      const acceptedAt = new Date();
      const [claimed] = await tx
        .update(platformStaffInvitations)
        .set({ acceptedAt, acceptedByIdentityId: identityId })
        .where(
          and(
            eq(platformStaffInvitations.id, invitation.id),
            isNull(platformStaffInvitations.acceptedAt),
            isNull(platformStaffInvitations.revokedAt),
            gt(platformStaffInvitations.expiresAt, acceptedAt),
          ),
        )
        .returning({ id: platformStaffInvitations.id });
      if (!claimed) {
        throw new BadRequestException({ code: "INVALID_PLATFORM_INVITATION" });
      }
      await tx
        .insert(platformStaffAccess)
        .values({
          identityId,
          role: invitation.role,
          grantedByIdentityId: invitation.invitedByIdentityId,
        })
        .onConflictDoUpdate({
          target: platformStaffAccess.identityId,
          set: {
            role: invitation.role,
            grantedByIdentityId: invitation.invitedByIdentityId,
            revokedAt: null,
            revokedByIdentityId: null,
            createdAt: acceptedAt,
            updatedAt: new Date(),
          },
        });
      if (!identity.emailVerifiedAt) {
        await tx
          .update(identities)
          .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(identities.id, identityId), isNull(identities.emailVerifiedAt)));
      }
      await tx.insert(auditEvents).values({
        actorIdentityId: identityId,
        action: "platform.team.invitation.accepted",
        entityType: "platform_staff_invitation",
        entityId: invitation.id,
        metadata: { role: invitation.role },
      });
      return {
        role: invitation.role,
        acceptedAt: acceptedAt.toISOString(),
        mfaRequired: true,
        replayed: false,
      };
    });
  }

  async cancelInvitation(
    actorIdentityId: string,
    invitationId: string,
    idempotencyKey: string,
    input: PlatformStaffActionInput,
  ) {
    const replay = await this.replay(
      actorIdentityId,
      idempotencyKey,
      "platform.team.invitation.revoked",
      invitationId,
      input.reason,
    );
    if (replay) return replay;
    return this.revoke(
      actorIdentityId,
      "invitation",
      invitationId,
      idempotencyKey,
      input.reason,
      input.reauth,
    );
  }

  async revokeMember(
    actorIdentityId: string,
    identityId: string,
    idempotencyKey: string,
    input: PlatformStaffActionInput,
  ) {
    if (identityId === actorIdentityId) {
      throw new BadRequestException({
        code: "PLATFORM_STAFF_SELF_REVOKE_FORBIDDEN",
        message: "Outro administrador deve remover o seu acesso.",
      });
    }
    const replay = await this.replay(
      actorIdentityId,
      idempotencyKey,
      "platform.team.access.revoked",
      identityId,
      input.reason,
    );
    if (replay) return replay;
    return this.revoke(
      actorIdentityId,
      "member",
      identityId,
      idempotencyKey,
      input.reason,
      input.reauth,
    );
  }

  private async revoke(
    actorIdentityId: string,
    targetType: "invitation" | "member",
    targetId: string,
    idempotencyKey: string,
    reason: string,
    reauth: PlatformStaffActionInput["reauth"],
  ) {
    const action =
      targetType === "member" ? "platform.team.access.revoked" : "platform.team.invitation.revoked";
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`platform-action:${actorIdentityId}:${idempotencyKey}`}, 0))`,
      );
      const [receipt] = await tx
        .select()
        .from(platformActionReceipts)
        .where(
          and(
            eq(platformActionReceipts.actorIdentityId, actorIdentityId),
            eq(platformActionReceipts.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (receipt) {
        if (
          receipt.action !== action ||
          receipt.targetId !== targetId ||
          receipt.reason !== reason
        ) {
          throw new ConflictException({ code: "PLATFORM_IDEMPOTENCY_KEY_REUSED" });
        }
        return { ...(receipt.result as Record<string, unknown>), replayed: true };
      }
      await this.auth.verifyStepUp(actorIdentityId, reauth);
      if (targetType === "invitation") {
        const [invitation] = await tx
          .select({ email: platformStaffInvitations.email })
          .from(platformStaffInvitations)
          .where(eq(platformStaffInvitations.id, targetId))
          .limit(1);
        if (!invitation) throw new NotFoundException({ code: "PLATFORM_TEAM_TARGET_NOT_FOUND" });
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`platform-staff:${invitation.email}`}, 0))`,
        );
      }
      const now = new Date();
      const [updated] =
        targetType === "member"
          ? await tx
              .update(platformStaffAccess)
              .set({ revokedAt: now, revokedByIdentityId: actorIdentityId, updatedAt: now })
              .where(
                and(
                  eq(platformStaffAccess.identityId, targetId),
                  isNull(platformStaffAccess.revokedAt),
                ),
              )
              .returning({ id: platformStaffAccess.identityId })
          : await tx
              .update(platformStaffInvitations)
              .set({ revokedAt: now })
              .where(
                and(
                  eq(platformStaffInvitations.id, targetId),
                  isNull(platformStaffInvitations.acceptedAt),
                  isNull(platformStaffInvitations.revokedAt),
                ),
              )
              .returning({ id: platformStaffInvitations.id });
      if (!updated) throw new NotFoundException({ code: "PLATFORM_TEAM_TARGET_NOT_FOUND" });
      const result = { id: targetId, revokedAt: now.toISOString(), replayed: false };
      await tx.insert(auditEvents).values({
        actorIdentityId,
        action,
        entityType: targetType === "member" ? "platform_staff_access" : "platform_staff_invitation",
        entityId: targetId,
        metadata: { reason },
      });
      await tx.insert(platformActionReceipts).values({
        actorIdentityId,
        idempotencyKey,
        action,
        targetType: `platform_staff_${targetType}`,
        targetId,
        reason,
        result,
      });
      return result;
    });
  }

  private async replay(
    actorIdentityId: string,
    idempotencyKey: string,
    action: string,
    targetId: string,
    reason: string,
    role?: string,
  ) {
    const [receipt] = await this.database.db
      .select()
      .from(platformActionReceipts)
      .where(
        and(
          eq(platformActionReceipts.actorIdentityId, actorIdentityId),
          eq(platformActionReceipts.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (!receipt) return null;
    if (
      receipt.action !== action ||
      receipt.targetId !== targetId ||
      receipt.reason !== reason ||
      (role !== undefined && (receipt.result as Record<string, unknown>).role !== role)
    ) {
      throw new ConflictException({ code: "PLATFORM_IDEMPOTENCY_KEY_REUSED" });
    }
    return { ...(receipt.result as Record<string, unknown>), replayed: true };
  }
}
