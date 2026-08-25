import { createHash, randomBytes } from "node:crypto";
import type {
  ConfirmPasswordResetInput,
  LoginInput,
  RegisterInput,
  RequestPasswordResetInput,
} from "@giromesa/contracts";
import {
  auditEvents,
  authSessions,
  identities,
  managementCashShifts,
  memberships,
  mfaChallenges,
  mfaFactors,
  oauthAccounts,
  outboxEvents,
  passwordCredentials,
  passwordResetTokens,
  roleBindings,
} from "@giromesa/db";
import { encryptionKey, encryptSecret } from "@giromesa/domain";
import {
  ConflictException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { and, desc, eq, gt, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { isPlatformAdminEmail } from "../platform/platform-access.js";
import type { GoogleAuthIntent, GoogleProfile } from "./google-oauth.js";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  generateMfaSecret,
  generateRecoveryCodes,
  inheritedMfaAttempts,
  mfaKey,
  otpauthUri,
  recoveryCodeHash,
  recoveryCodeMatches,
  totpReplayHash,
  verifiedTotpCounter,
} from "./mfa.js";

export interface AuthContext {
  identityId: string;
  email: string;
  displayName: string;
  sessionId: string;
  expiresAt: Date;
  authKind?: "identity" | "terminal";
  organizationId?: string;
  unitId?: string;
  actorEpoch?: number;
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

@Injectable()
export class AuthService {
  constructor(private readonly database: DatabaseService) {}

  async register(input: RegisterInput) {
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const token = randomBytes(32).toString("base64url");
    const expiresAt = this.sessionExpiration(false);
    try {
      return await this.database.db.transaction(async (tx) => {
        const [identity] = await tx
          .insert(identities)
          .values({ email: input.email, displayName: input.displayName })
          .returning();
        if (!identity) throw new Error("Identity was not created");
        await tx.insert(passwordCredentials).values({ identityId: identity.id, passwordHash });
        const [session] = await tx
          .insert(authSessions)
          .values({
            identityId: identity.id,
            tokenHash: tokenHash(token),
            trustedDevice: false,
            expiresAt,
          })
          .returning({ id: authSessions.id });
        if (!session) throw new Error("Registration session was not created");
        await tx.insert(auditEvents).values({
          actorIdentityId: identity.id,
          action: "identity.registered",
          entityType: "identity",
          entityId: identity.id,
          metadata: { termsVersion: process.env.LEGAL_TERMS_VERSION ?? "2026-08-09" },
        });
        await tx.insert(outboxEvents).values({
          topic: "identity.registered",
          aggregateType: "identity",
          aggregateId: identity.id,
          payload: { identityId: identity.id },
        });
        await tx.insert(auditEvents).values({
          actorIdentityId: identity.id,
          action: "auth.registration_login",
          entityType: "session",
          entityId: session.id,
        });
        return {
          token,
          expiresAt,
          identity: { id: identity.id, email: identity.email, displayName: identity.displayName },
        };
      });
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "23505") {
        throw new ConflictException({
          code: "IDENTITY_EXISTS",
          message: "Já existe uma conta com este e-mail.",
        });
      }
      throw error;
    }
  }

  async login(input: LoginInput) {
    const [record] = await this.database.db
      .select({ identity: identities, passwordHash: passwordCredentials.passwordHash })
      .from(identities)
      .innerJoin(passwordCredentials, eq(passwordCredentials.identityId, identities.id))
      .where(and(eq(identities.email, input.email), isNull(identities.disabledAt)))
      .limit(1);

    const valid = record
      ? await argon2.verify(record.passwordHash, input.password)
      : await this.consumeComparablePasswordWork(input.password);
    if (!record || !valid) {
      throw new UnauthorizedException({
        code: "INVALID_CREDENTIALS",
        message: "E-mail ou senha inválidos.",
      });
    }

    return this.beginIdentitySession(record.identity, input.trustedDevice, "auth.login");
  }

  async authenticateGoogle(profile: GoogleProfile, intent: GoogleAuthIntent) {
    const identity = await this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`google:${profile.subject}`}::text, 0))`,
      );
      const [linked] = await tx
        .select({ identity: identities })
        .from(oauthAccounts)
        .innerJoin(identities, eq(identities.id, oauthAccounts.identityId))
        .where(
          and(
            eq(oauthAccounts.provider, "google"),
            eq(oauthAccounts.providerSubject, profile.subject),
          ),
        )
        .limit(1);
      if (linked) {
        if (linked.identity.disabledAt) throw new UnauthorizedException();
        return {
          id: linked.identity.id,
          email: linked.identity.email,
          displayName: linked.identity.displayName,
        };
      }

      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`identity-email:${profile.email}`}::text, 0))`,
      );
      const [existing] = await tx
        .select()
        .from(identities)
        .where(eq(identities.email, profile.email))
        .limit(1);
      if (existing?.disabledAt) throw new UnauthorizedException();
      if (!existing && intent === "login") {
        throw new UnauthorizedException({
          code: "GOOGLE_ACCOUNT_NOT_LINKED",
          message: "Crie sua conta com Google antes do primeiro acesso.",
        });
      }
      const identity =
        existing ??
        (
          await tx
            .insert(identities)
            .values({
              email: profile.email,
              displayName: profile.displayName,
              emailVerifiedAt: new Date(),
            })
            .returning()
        )[0];
      if (!identity) throw new Error("Google identity was not created");
      await tx.insert(oauthAccounts).values({
        identityId: identity.id,
        provider: "google",
        providerSubject: profile.subject,
      });
      if (!identity.emailVerifiedAt) {
        await tx
          .update(identities)
          .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
          .where(eq(identities.id, identity.id));
      }
      await tx.insert(auditEvents).values({
        actorIdentityId: identity.id,
        action: existing ? "auth.google_linked" : "identity.google_registered",
        entityType: "identity",
        entityId: identity.id,
        metadata: existing ? {} : { termsVersion: process.env.LEGAL_TERMS_VERSION ?? "2026-08-09" },
      });
      if (!existing) {
        await tx.insert(outboxEvents).values({
          topic: "identity.registered",
          aggregateType: "identity",
          aggregateId: identity.id,
          payload: { identityId: identity.id },
        });
      }
      return { id: identity.id, email: identity.email, displayName: identity.displayName };
    });
    return this.beginIdentitySession(identity, false, "auth.google_login");
  }

  async verifyMfaChallenge(input: {
    challengeToken: string;
    code?: string;
    recoveryCode?: string;
  }) {
    const [candidate] = await this.database.db
      .select({ id: mfaChallenges.id, identityId: mfaChallenges.identityId })
      .from(mfaChallenges)
      .where(eq(mfaChallenges.tokenHash, tokenHash(input.challengeToken)))
      .limit(1);
    if (!candidate) throw this.invalidMfaChallenge();

    const result = await this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${candidate.identityId}::text, 0))`,
      );
      const [challenge] = await tx
        .select({ challenge: mfaChallenges, identity: identities, factor: mfaFactors })
        .from(mfaChallenges)
        .innerJoin(identities, eq(identities.id, mfaChallenges.identityId))
        .innerJoin(mfaFactors, eq(mfaFactors.identityId, identities.id))
        .where(
          and(
            eq(mfaChallenges.id, candidate.id),
            isNull(mfaChallenges.usedAt),
            gt(mfaChallenges.expiresAt, new Date()),
            lt(mfaChallenges.attempts, 5),
            isNull(identities.disabledAt),
          ),
        )
        .limit(1);
      if (!challenge?.factor.verifiedAt) return null;

      const key = this.getMfaKey();
      const secret = decryptMfaSecret(challenge.factor, key);
      const acceptedCounter = input.code ? verifiedTotpCounter(secret, input.code) : null;
      const recoveryIndex = input.recoveryCode
        ? recoveryCodeMatches(input.recoveryCode, challenge.factor.recoveryCodeHashes, key)
        : -1;
      if (acceptedCounter === null && recoveryIndex < 0) {
        await tx
          .update(mfaChallenges)
          .set({
            attempts: sql`${mfaChallenges.attempts} + 1`,
            usedAt: sql`case when ${mfaChallenges.attempts} >= 4 then now() else ${mfaChallenges.usedAt} end`,
          })
          .where(and(eq(mfaChallenges.id, challenge.challenge.id), isNull(mfaChallenges.usedAt)));
        return null;
      }

      if (acceptedCounter !== null) {
        const [replayMarker] = await tx
          .insert(mfaChallenges)
          .values({
            identityId: challenge.identity.id,
            tokenHash: totpReplayHash(challenge.identity.id, acceptedCounter, key),
            attempts: 0,
            expiresAt: new Date((acceptedCounter + 2) * 30_000),
            usedAt: new Date(),
          })
          .onConflictDoNothing({ target: mfaChallenges.tokenHash })
          .returning({ id: mfaChallenges.id });
        if (!replayMarker) {
          await tx
            .update(mfaChallenges)
            .set({ usedAt: new Date() })
            .where(eq(mfaChallenges.id, challenge.challenge.id));
          return null;
        }
      }

      const [claimed] = await tx
        .update(mfaChallenges)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(mfaChallenges.id, challenge.challenge.id),
            isNull(mfaChallenges.usedAt),
            gt(mfaChallenges.expiresAt, new Date()),
          ),
        )
        .returning({ id: mfaChallenges.id });
      if (!claimed) return null;
      await tx
        .update(mfaChallenges)
        .set({ usedAt: new Date() })
        .where(
          and(eq(mfaChallenges.identityId, challenge.identity.id), isNull(mfaChallenges.usedAt)),
        );
      if (recoveryIndex >= 0) {
        const remaining = challenge.factor.recoveryCodeHashes.filter(
          (_, index) => index !== recoveryIndex,
        );
        await tx
          .update(mfaFactors)
          .set({ recoveryCodeHashes: remaining, updatedAt: new Date() })
          .where(eq(mfaFactors.identityId, challenge.identity.id));
      }
      const token = randomBytes(32).toString("base64url");
      const expiresAt = this.sessionExpiration(challenge.challenge.trustedDevice);
      const [session] = await tx
        .insert(authSessions)
        .values({
          identityId: challenge.identity.id,
          tokenHash: tokenHash(token),
          trustedDevice: challenge.challenge.trustedDevice,
          expiresAt,
        })
        .returning({ id: authSessions.id });
      if (!session) throw new Error("Session was not created");
      await tx.insert(auditEvents).values({
        actorIdentityId: challenge.identity.id,
        action: "auth.mfa_verified",
        entityType: "session",
        entityId: session.id,
      });
      return {
        token,
        expiresAt,
        identity: {
          id: challenge.identity.id,
          email: challenge.identity.email,
          displayName: challenge.identity.displayName,
        },
      };
    });
    if (!result) throw this.invalidMfaChallenge();
    return result;
  }

  async mfaStatus(identityId: string) {
    const [factor] = await this.database.db
      .select({ verifiedAt: mfaFactors.verifiedAt })
      .from(mfaFactors)
      .where(eq(mfaFactors.identityId, identityId))
      .limit(1);
    return { enabled: Boolean(factor?.verifiedAt), pending: Boolean(factor && !factor.verifiedAt) };
  }

  async beginMfaSetup(identityId: string) {
    const key = this.getMfaKey();
    const secret = generateMfaSecret();
    const encrypted = encryptMfaSecret(secret, key);
    const [identity] = await this.database.db
      .select({ email: identities.email })
      .from(identities)
      .where(eq(identities.id, identityId))
      .limit(1);
    if (!identity) throw new UnauthorizedException();
    const [stored] = await this.database.db
      .insert(mfaFactors)
      .values({ identityId, ...encrypted, recoveryCodeHashes: [], verifiedAt: null })
      .onConflictDoUpdate({
        target: mfaFactors.identityId,
        set: { ...encrypted, recoveryCodeHashes: [], verifiedAt: null, updatedAt: new Date() },
        setWhere: isNull(mfaFactors.verifiedAt),
      })
      .returning({ identityId: mfaFactors.identityId });
    if (!stored) {
      throw new ConflictException({
        code: "MFA_ALREADY_ENABLED",
        message: "Desative o MFA atual antes de configurar um novo autenticador.",
      });
    }
    await this.database.db.insert(auditEvents).values({
      actorIdentityId: identityId,
      action: "auth.mfa_setup_started",
      entityType: "identity",
      entityId: identityId,
    });
    return { secret, otpauthUri: otpauthUri(secret, identity.email) };
  }

  async confirmMfaSetup(identityId: string, currentSessionId: string, code: string) {
    const [factor] = await this.database.db
      .select()
      .from(mfaFactors)
      .where(and(eq(mfaFactors.identityId, identityId), isNull(mfaFactors.verifiedAt)))
      .limit(1);
    if (!factor) throw this.invalidMfaChallenge();
    const key = this.getMfaKey();
    const acceptedCounter = verifiedTotpCounter(decryptMfaSecret(factor, key), code);
    if (acceptedCounter === null) {
      throw this.invalidMfaChallenge();
    }
    const recoveryCodes = generateRecoveryCodes();
    await this.database.db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(mfaFactors)
        .set({
          verifiedAt: new Date(),
          recoveryCodeHashes: recoveryCodes.map((value) => recoveryCodeHash(value, key)),
          updatedAt: new Date(),
        })
        .where(and(eq(mfaFactors.identityId, identityId), isNull(mfaFactors.verifiedAt)))
        .returning({ identityId: mfaFactors.identityId });
      if (!claimed) throw this.invalidMfaChallenge();
      const [replayMarker] = await tx
        .insert(mfaChallenges)
        .values({
          identityId,
          tokenHash: totpReplayHash(identityId, acceptedCounter, key),
          attempts: 0,
          expiresAt: new Date((acceptedCounter + 2) * 30_000),
          usedAt: new Date(),
        })
        .onConflictDoNothing({ target: mfaChallenges.tokenHash })
        .returning({ id: mfaChallenges.id });
      if (!replayMarker) throw this.invalidMfaChallenge();
      await tx
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(authSessions.identityId, identityId),
            ne(authSessions.id, currentSessionId),
            isNull(authSessions.revokedAt),
          ),
        );
      await tx.insert(auditEvents).values({
        actorIdentityId: identityId,
        action: "auth.mfa_enabled",
        entityType: "identity",
        entityId: identityId,
      });
    });
    return { recoveryCodes };
  }

  async disableMfa(identityId: string, proof: { code?: string; recoveryCode?: string }) {
    const disabled = await this.database.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${identityId}::text, 0))`);
      const [factor] = await tx
        .select()
        .from(mfaFactors)
        .where(eq(mfaFactors.identityId, identityId))
        .limit(1);
      if (!factor?.verifiedAt) return false;
      const key = this.getMfaKey();
      const secret = decryptMfaSecret(factor, key);
      const acceptedCounter = proof.code ? verifiedTotpCounter(secret, proof.code) : null;
      const recoveryIndex = proof.recoveryCode
        ? recoveryCodeMatches(proof.recoveryCode, factor.recoveryCodeHashes, key)
        : -1;
      if (acceptedCounter === null && recoveryIndex < 0) return false;
      if (acceptedCounter !== null) {
        const [replayMarker] = await tx
          .insert(mfaChallenges)
          .values({
            identityId,
            tokenHash: totpReplayHash(identityId, acceptedCounter, key),
            attempts: 0,
            expiresAt: new Date((acceptedCounter + 2) * 30_000),
            usedAt: new Date(),
          })
          .onConflictDoNothing({ target: mfaChallenges.tokenHash })
          .returning({ id: mfaChallenges.id });
        if (!replayMarker) return false;
      }
      const [deleted] = await tx
        .delete(mfaFactors)
        .where(eq(mfaFactors.identityId, identityId))
        .returning({ identityId: mfaFactors.identityId });
      if (!deleted) return false;
      await tx.insert(auditEvents).values({
        actorIdentityId: identityId,
        action: "auth.mfa_disabled",
        entityType: "identity",
        entityId: identityId,
      });
      return true;
    });
    if (!disabled) throw this.invalidMfaChallenge();
  }

  async authenticate(token: string): Promise<AuthContext | null> {
    const [record] = await this.database.db
      .select({
        sessionId: authSessions.id,
        identityId: identities.id,
        email: identities.email,
        displayName: identities.displayName,
        expiresAt: authSessions.expiresAt,
      })
      .from(authSessions)
      .innerJoin(identities, eq(identities.id, authSessions.identityId))
      .where(
        and(
          eq(authSessions.tokenHash, tokenHash(token)),
          isNull(authSessions.revokedAt),
          gt(authSessions.expiresAt, new Date()),
          isNull(identities.disabledAt),
        ),
      )
      .limit(1);
    return record ?? null;
  }

  async verifyStepUp(
    identityId: string,
    proof: { currentPassword?: string; mfaCode?: string } | undefined,
  ) {
    if (!proof || Boolean(proof.currentPassword) === Boolean(proof.mfaCode)) {
      throw new UnauthorizedException({
        code: "ACCESS_STEP_UP_REQUIRED",
        message: "Confirme sua identidade para liberar este perfil sensível.",
      });
    }

    let method: "password" | "mfa" | null = null;
    if (proof.currentPassword) {
      const [credential] = await this.database.db
        .select({ passwordHash: passwordCredentials.passwordHash })
        .from(passwordCredentials)
        .where(eq(passwordCredentials.identityId, identityId))
        .limit(1);
      const valid = credential
        ? await argon2.verify(credential.passwordHash, proof.currentPassword)
        : false;
      if (!credential) await argon2.hash(proof.currentPassword);
      if (valid) method = "password";
    } else if (proof.mfaCode) {
      const [factor] = await this.database.db
        .select()
        .from(mfaFactors)
        .where(and(eq(mfaFactors.identityId, identityId), isNotNull(mfaFactors.verifiedAt)))
        .limit(1);
      if (factor) {
        const key = this.getMfaKey();
        const acceptedCounter = verifiedTotpCounter(decryptMfaSecret(factor, key), proof.mfaCode);
        if (acceptedCounter !== null) {
          const [marker] = await this.database.db
            .insert(mfaChallenges)
            .values({
              identityId,
              tokenHash: totpReplayHash(identityId, acceptedCounter, key),
              attempts: 0,
              expiresAt: new Date((acceptedCounter + 2) * 30_000),
              usedAt: new Date(),
            })
            .onConflictDoNothing({ target: mfaChallenges.tokenHash })
            .returning({ id: mfaChallenges.id });
          if (marker) method = "mfa";
        }
      }
    }

    if (!method) {
      throw new UnauthorizedException({
        code: "ACCESS_STEP_UP_INVALID",
        message: "A confirmação de identidade não foi aceita.",
      });
    }
    await this.database.db.insert(auditEvents).values({
      actorIdentityId: identityId,
      action: "auth.step_up_verified",
      entityType: "identity",
      entityId: identityId,
      metadata: { method },
    });
  }

  async revoke(sessionId: string, identityId: string) {
    await this.assertCanEndOperation(identityId);
    await this.database.db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(authSessions.id, sessionId), eq(authSessions.identityId, identityId)));
    await this.database.db.insert(auditEvents).values({
      actorIdentityId: identityId,
      action: "auth.logout",
      entityType: "session",
      entityId: sessionId,
    });
  }

  async assertCanEndOperation(
    identityId: string,
    scope?: { organizationId: string; unitId: string },
  ) {
    const [openShift] = await this.database.db
      .select({
        id: managementCashShifts.id,
        organizationId: managementCashShifts.organizationId,
        unitId: managementCashShifts.unitId,
      })
      .from(managementCashShifts)
      .where(
        and(
          eq(managementCashShifts.status, "open"),
          eq(managementCashShifts.currentResponsibleIdentityId, identityId),
          scope ? eq(managementCashShifts.organizationId, scope.organizationId) : undefined,
          scope ? eq(managementCashShifts.unitId, scope.unitId) : undefined,
        ),
      )
      .limit(1);
    if (!openShift) return;
    throw new ConflictException({
      code: "CASH_SHIFT_OPEN",
      message:
        "Você ainda é responsável por um caixa aberto. Feche o caixa ou transfira a responsabilidade antes de encerrar a operação.",
      cashShiftId: openShift.id,
      organizationId: openShift.organizationId,
      unitId: openShift.unitId,
    });
  }

  async me(identityId: string) {
    const [identity] = await this.database.db
      .select({ id: identities.id, email: identities.email, displayName: identities.displayName })
      .from(identities)
      .where(eq(identities.id, identityId))
      .limit(1);
    if (!identity) throw new UnauthorizedException();
    const scopes = await this.database.db
      .select({
        membershipId: memberships.id,
        organizationId: memberships.organizationId,
        status: memberships.status,
        role: roleBindings.role,
        unitId: roleBindings.unitId,
      })
      .from(memberships)
      .leftJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
      .where(eq(memberships.identityId, identityId));
    return { identity, memberships: scopes, platformAdmin: isPlatformAdminEmail(identity.email) };
  }

  async requestPasswordReset(input: RequestPasswordResetInput) {
    if (process.env.EMAIL_PROVIDER_ENABLED !== "true") return;
    const encryption = encryptionKey(process.env.OUTBOX_ENCRYPTION_KEY, "OUTBOX_ENCRYPTION_KEY");
    const [identity] = await this.database.db
      .select({ id: identities.id })
      .from(identities)
      .where(eq(identities.email, input.email))
      .limit(1);
    if (!identity) return;
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await this.database.db.transaction(async (tx) => {
      await tx
        .insert(passwordResetTokens)
        .values({ identityId: identity.id, tokenHash: tokenHash(token), expiresAt });
      await tx.insert(outboxEvents).values({
        topic: "auth.password_reset_requested",
        aggregateType: "identity",
        aggregateId: identity.id,
        payload: {
          identityId: identity.id,
          resetTokenEnvelope: encryptSecret(token, encryption, `identity:${identity.id}`),
          expiresAt: expiresAt.toISOString(),
        },
      });
      await tx.insert(auditEvents).values({
        actorIdentityId: identity.id,
        action: "auth.password_reset_requested",
        entityType: "identity",
        entityId: identity.id,
      });
    });
  }

  async confirmPasswordReset(input: ConfirmPasswordResetInput) {
    const [reset] = await this.database.db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash(input.token)),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!reset)
      throw new UnauthorizedException({
        code: "INVALID_RESET_TOKEN",
        message: "Link de redefinição inválido ou expirado.",
      });
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    await this.database.db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(passwordResetTokens.id, reset.id),
            isNull(passwordResetTokens.usedAt),
            gt(passwordResetTokens.expiresAt, new Date()),
          ),
        )
        .returning({ identityId: passwordResetTokens.identityId });
      if (!claimed) {
        throw new UnauthorizedException({
          code: "INVALID_RESET_TOKEN",
          message: "Link de redefinição inválido ou expirado.",
        });
      }
      await tx
        .insert(passwordCredentials)
        .values({ identityId: reset.identityId, passwordHash, passwordChangedAt: new Date() })
        .onConflictDoUpdate({
          target: passwordCredentials.identityId,
          set: { passwordHash, passwordChangedAt: new Date() },
        });
      await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(passwordResetTokens.identityId, reset.identityId),
            isNull(passwordResetTokens.usedAt),
          ),
        );
      await tx
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(authSessions.identityId, reset.identityId), isNull(authSessions.revokedAt)));
      await tx.insert(auditEvents).values({
        actorIdentityId: reset.identityId,
        action: "auth.password_reset_completed",
        entityType: "identity",
        entityId: reset.identityId,
      });
    });
  }

  private async consumeComparablePasswordWork(password: string) {
    await argon2.hash(password, { type: argon2.argon2id });
    return false;
  }

  private async beginIdentitySession(
    identity: { id: string; email: string; displayName: string },
    trustedDevice: boolean,
    action: string,
  ) {
    const [factor] = await this.database.db
      .select({ verifiedAt: mfaFactors.verifiedAt })
      .from(mfaFactors)
      .where(eq(mfaFactors.identityId, identity.id))
      .limit(1);
    if (!factor?.verifiedAt) return this.createSession(identity, trustedDevice, action);

    const challengeToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${identity.id}::text, 0))`,
      );
      const [recentChallenge] = await tx
        .select({ attempts: mfaChallenges.attempts })
        .from(mfaChallenges)
        .where(
          and(
            eq(mfaChallenges.identityId, identity.id),
            gt(mfaChallenges.createdAt, new Date(Date.now() - 15 * 60 * 1000)),
          ),
        )
        .orderBy(desc(mfaChallenges.createdAt), desc(mfaChallenges.id))
        .limit(1);
      const attempts = inheritedMfaAttempts(recentChallenge?.attempts);
      if (attempts === null) {
        throw new HttpException(
          {
            code: "MFA_LOCKED",
            message: "Muitas tentativas de MFA. Tente novamente em alguns minutos.",
          },
          429,
        );
      }
      await tx
        .update(mfaChallenges)
        .set({ usedAt: new Date() })
        .where(and(eq(mfaChallenges.identityId, identity.id), isNull(mfaChallenges.usedAt)));
      await tx.insert(mfaChallenges).values({
        identityId: identity.id,
        tokenHash: tokenHash(challengeToken),
        trustedDevice,
        attempts,
        expiresAt,
      });
    });
    return { mfaRequired: true as const, challengeToken, expiresAt };
  }

  private async createSession(
    identity: { id: string; email: string; displayName: string },
    trustedDevice: boolean,
    action: string,
  ) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = this.sessionExpiration(trustedDevice);
    const [session] = await this.database.db
      .insert(authSessions)
      .values({
        identityId: identity.id,
        tokenHash: tokenHash(token),
        trustedDevice,
        expiresAt,
      })
      .returning({ id: authSessions.id });
    if (!session) throw new Error("Session was not created");
    await this.database.db.insert(auditEvents).values({
      actorIdentityId: identity.id,
      action,
      entityType: "session",
      entityId: session.id,
    });
    return { token, expiresAt, identity };
  }

  private sessionExpiration(trustedDevice: boolean) {
    return new Date(Date.now() + (trustedDevice ? 30 : 0.5) * 24 * 60 * 60 * 1000);
  }

  private getMfaKey() {
    try {
      return mfaKey();
    } catch {
      throw new ServiceUnavailableException({
        code: "MFA_NOT_CONFIGURED",
        message: "MFA ainda não foi configurado para este ambiente.",
      });
    }
  }

  private invalidMfaChallenge() {
    return new UnauthorizedException({
      code: "INVALID_MFA_CHALLENGE",
      message: "Código MFA, recuperação ou desafio inválido.",
    });
  }
}
