import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  ConfirmPasswordResetInput,
  LoginInput,
  RegisterInput,
  RequestEmailVerificationInput,
  RequestPasswordResetInput,
  VerifyEmailInput,
} from "@giromesa/contracts";
import {
  auditEvents,
  authSessions,
  emailVerificationRequests,
  emailVerificationTokens,
  identities,
  memberships,
  mfaChallenges,
  mfaFactors,
  oauthAccounts,
  outboxEvents,
  passwordCredentials,
  passwordResetTokens,
  roleBindings,
  type TenantTransaction,
} from "@giromesa/db";
import { encryptionKey, encryptSecret } from "@giromesa/domain";
import {
  BadRequestException,
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
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1_000;
const EMAIL_VERIFICATION_ACCEPTED = Object.freeze({ accepted: true as const });

function databaseErrorCode(error: unknown) {
  let candidate = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!candidate || typeof candidate !== "object") return undefined;
    if ("code" in candidate && typeof candidate.code === "string") return candidate.code;
    candidate = "cause" in candidate ? candidate.cause : undefined;
  }
  return undefined;
}

@Injectable()
export class AuthService {
  constructor(private readonly database: DatabaseService) {}

  async register(input: RegisterInput) {
    const encryption = this.emailVerificationEncryption();
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    try {
      return await this.database.db.transaction(async (tx) => {
        const [identity] = await tx
          .insert(identities)
          .values({ email: input.email, displayName: input.displayName })
          .returning();
        if (!identity) throw new Error("Identity was not created");
        await tx.insert(passwordCredentials).values({ identityId: identity.id, passwordHash });
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
        await this.enqueueInitialEmailVerification(tx, identity, encryption);
        return {
          accepted: true as const,
          email: identity.email,
          verificationRequired: true as const,
        };
      });
    } catch (error) {
      if (databaseErrorCode(error) === "23505") {
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

    if (!record.identity.emailVerifiedAt) {
      throw new UnauthorizedException({
        code: "EMAIL_VERIFICATION_REQUIRED",
        message: "Verifique seu e-mail antes de entrar.",
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
        if (!linked.identity.emailVerifiedAt) {
          await tx
            .update(identities)
            .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
            .where(and(eq(identities.id, linked.identity.id), isNull(identities.emailVerifiedAt)));
        }
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

  async requestEmailVerification(input: RequestEmailVerificationInput) {
    const encryption = this.emailVerificationEncryption();
    const email = input.email.trim().toLowerCase();
    const identity = { id: "", email, displayName: "" };
    await this.database.db.transaction((tx) =>
      this.enqueueEmailVerification(tx, identity, encryption, "resend"),
    );
    return EMAIL_VERIFICATION_ACCEPTED;
  }

  async verifyEmail(input: VerifyEmailInput) {
    const suppliedHash = tokenHash(input.token);
    const verification = await this.database.db.transaction(async (tx) => {
      const [candidate] = await tx
        .select({ identityId: emailVerificationTokens.identityId })
        .from(emailVerificationTokens)
        .where(eq(emailVerificationTokens.tokenHash, suppliedHash))
        .limit(1);
      if (!candidate) throw this.invalidEmailVerification();

      const [identityForLock] = await tx
        .select({ email: identities.email })
        .from(identities)
        .where(eq(identities.id, candidate.identityId))
        .limit(1);
      if (!identityForLock) throw this.invalidEmailVerification();
      const emailHash = tokenHash(identityForLock.email.trim().toLowerCase());
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`email-verification:${emailHash}`}::text, 0))`,
      );

      const [record] = await tx
        .select({ token: emailVerificationTokens, identity: identities })
        .from(emailVerificationTokens)
        .innerJoin(identities, eq(identities.id, emailVerificationTokens.identityId))
        .where(eq(emailVerificationTokens.tokenHash, suppliedHash))
        .limit(1);
      if (!record || record.identity.disabledAt) throw this.invalidEmailVerification();
      if (record.identity.emailVerifiedAt) return { status: "already_verified" as const };
      if (record.token.usedAt || record.token.revokedAt || record.token.expiresAt <= new Date()) {
        throw this.invalidEmailVerification();
      }

      const [claimed] = await tx
        .update(emailVerificationTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(emailVerificationTokens.id, record.token.id),
            isNull(emailVerificationTokens.usedAt),
            isNull(emailVerificationTokens.revokedAt),
            gt(emailVerificationTokens.expiresAt, new Date()),
          ),
        )
        .returning({ identityId: emailVerificationTokens.identityId });
      if (!claimed) throw this.invalidEmailVerification();

      const verifiedAt = new Date();
      const [verified] = await tx
        .update(identities)
        .set({ emailVerifiedAt: verifiedAt, updatedAt: verifiedAt })
        .where(
          and(
            eq(identities.id, record.identity.id),
            isNull(identities.emailVerifiedAt),
            isNull(identities.disabledAt),
          ),
        )
        .returning({ id: identities.id });
      if (!verified) throw this.invalidEmailVerification();
      await tx
        .update(emailVerificationTokens)
        .set({ revokedAt: verifiedAt })
        .where(
          and(
            eq(emailVerificationTokens.identityId, record.identity.id),
            isNull(emailVerificationTokens.usedAt),
            isNull(emailVerificationTokens.revokedAt),
          ),
        );

      await tx
        .update(authSessions)
        .set({ revokedAt: verifiedAt })
        .where(
          and(eq(authSessions.identityId, record.identity.id), isNull(authSessions.revokedAt)),
        );

      await tx.insert(auditEvents).values({
        actorIdentityId: record.identity.id,
        action: "auth.email_verified",
        entityType: "identity",
        entityId: record.identity.id,
      });
      return {
        verifiedIdentity: {
          id: record.identity.id,
          email: record.identity.email,
          displayName: record.identity.displayName,
        },
      };
    });
    if ("status" in verification) return verification;

    const access = await this.beginIdentitySession(
      verification.verifiedIdentity,
      false,
      "auth.email_verification_session",
    );
    if ("mfaRequired" in access) {
      return { status: "mfa_required" as const, ...access };
    }
    return { status: "verified" as const, ...access };
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
          isNotNull(identities.emailVerifiedAt),
        ),
      )
      .limit(1);
    return record ?? null;
  }

  async revoke(sessionId: string, identityId: string) {
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

  private enqueueInitialEmailVerification(
    tx: TenantTransaction,
    identity: { id: string; email: string; displayName: string },
    encryption: ReturnType<typeof encryptionKey>,
  ) {
    return this.enqueueEmailVerification(tx, identity, encryption, "initial");
  }

  private async enqueueEmailVerification(
    tx: TenantTransaction,
    requestedIdentity: { id: string; email: string; displayName: string },
    encryption: ReturnType<typeof encryptionKey>,
    mode: "initial" | "resend",
  ) {
    const email = requestedIdentity.email.trim().toLowerCase();
    const emailHash = tokenHash(email);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`email-verification:${emailHash}`}::text, 0))`,
    );
    const now = new Date();
    const requests = await tx
      .select({ requestedAt: emailVerificationRequests.requestedAt })
      .from(emailVerificationRequests)
      .where(
        and(
          eq(emailVerificationRequests.emailHash, emailHash),
          gt(emailVerificationRequests.requestedAt, new Date(now.valueOf() - 24 * 60 * 60_000)),
        ),
      )
      .orderBy(desc(emailVerificationRequests.requestedAt));
    const latest = requests[0]?.requestedAt;
    const hourCount = requests.filter(
      (request) => request.requestedAt > new Date(now.valueOf() - 60 * 60_000),
    ).length;
    const rateLimited =
      (latest && now.valueOf() - latest.valueOf() < 60_000) ||
      hourCount >= 5 ||
      requests.length >= 10;
    if (rateLimited && mode === "resend") return EMAIL_VERIFICATION_ACCEPTED;

    const [storedIdentity] = await tx
      .select()
      .from(identities)
      .where(eq(identities.email, email))
      .limit(1);
    const identity =
      storedIdentity && (!requestedIdentity.id || requestedIdentity.id === storedIdentity.id)
        ? storedIdentity
        : undefined;
    if (mode === "initial") {
      if (!identity || identity.id !== requestedIdentity.id) {
        throw new Error("Initial e-mail verification requires the newly created identity");
      }
      const [existingToken] = await tx
        .select({ id: emailVerificationTokens.id })
        .from(emailVerificationTokens)
        .where(eq(emailVerificationTokens.identityId, identity.id))
        .limit(1);
      if (existingToken) {
        throw new Error("Initial e-mail verification was already issued");
      }
    }
    await tx.insert(emailVerificationRequests).values({
      emailHash,
      identityId: identity?.id ?? null,
      requestedAt: now,
    });
    if (!identity || identity.disabledAt || identity.emailVerifiedAt) {
      return mode === "resend" ? EMAIL_VERIFICATION_ACCEPTED : null;
    }

    await tx
      .update(emailVerificationTokens)
      .set({ revokedAt: now })
      .where(
        and(
          eq(emailVerificationTokens.identityId, identity.id),
          isNull(emailVerificationTokens.usedAt),
          isNull(emailVerificationTokens.revokedAt),
        ),
      );
    const verificationToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.valueOf() + EMAIL_VERIFICATION_TTL_MS);
    await tx.insert(emailVerificationTokens).values({
      identityId: identity.id,
      tokenHash: tokenHash(verificationToken),
      expiresAt,
    });
    const eventId = randomUUID();
    await tx.insert(outboxEvents).values({
      id: eventId,
      topic: "auth.email_verification_requested",
      aggregateType: "identity",
      aggregateId: identity.id,
      payload: {
        identityId: identity.id,
        verificationTokenEnvelope: encryptSecret(
          verificationToken,
          encryption,
          `email-verification:${identity.id}:${eventId}`,
        ),
        expiresAt: expiresAt.toISOString(),
      },
    });
    await tx.insert(auditEvents).values({
      actorIdentityId: identity.id,
      action: "auth.email_verification_requested",
      entityType: "identity",
      entityId: identity.id,
    });
    return EMAIL_VERIFICATION_ACCEPTED;
  }

  private emailVerificationEncryption() {
    if (process.env.EMAIL_PROVIDER_ENABLED !== "true") {
      throw new ServiceUnavailableException({
        code: "EMAIL_VERIFICATION_NOT_CONFIGURED",
        message: "A verificação de e-mail não está disponível neste ambiente.",
      });
    }
    try {
      return encryptionKey(process.env.OUTBOX_ENCRYPTION_KEY, "OUTBOX_ENCRYPTION_KEY");
    } catch {
      throw new ServiceUnavailableException({
        code: "EMAIL_VERIFICATION_NOT_CONFIGURED",
        message: "A verificação de e-mail não está disponível neste ambiente.",
      });
    }
  }

  private invalidEmailVerification() {
    return new BadRequestException({
      code: "INVALID_EMAIL_VERIFICATION_TOKEN",
      message: "Link de verificação inválido ou expirado.",
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
