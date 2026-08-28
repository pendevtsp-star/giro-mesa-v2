import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import {
  auditEvents,
  authSessions,
  identities,
  outboxEvents,
  platformActionReceipts,
  platformStaffAccess,
  platformStaffInvitations,
} from "@giromesa/db";
import { decryptSecret, encryptionKey, type SecretEnvelope } from "@giromesa/domain";
import type { ExecutionContext } from "@nestjs/common";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { AuthService } from "../auth/auth.service.js";
import { totpCode } from "../auth/mfa.js";
import { DatabaseService } from "../database/database.module.js";
import { PlatformAdminGuard, type PlatformRequest } from "./platform.guard.js";
import { PlatformTeamService } from "./platform-team.service.js";

function hasCode(error: unknown, code: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    JSON.stringify(error.response).includes(code)
  );
}

function contextFor(request: { auth: { identityId: string; email: string } }) {
  return {
    switchToHttp: () => ({ getRequest: () => request as unknown as PlatformRequest }),
  } as unknown as ExecutionContext;
}

test("invites, accepts and revokes platform staff with MFA, audit and no plaintext token", async (context) => {
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("PILOT_DATABASE_URL not configured");
    return;
  }
  const previous = {
    databaseUrl: process.env.DATABASE_URL,
    emailProviderEnabled: process.env.EMAIL_PROVIDER_ENABLED,
    mfaKey: process.env.MFA_ENCRYPTION_KEY,
    outboxKey: process.env.OUTBOX_ENCRYPTION_KEY,
    roles: process.env.PLATFORM_ADMIN_ROLES,
  };
  const outboxKey = Buffer.alloc(32, 17).toString("base64");
  process.env.DATABASE_URL = databaseUrl;
  process.env.EMAIL_PROVIDER_ENABLED = "true";
  process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 23).toString("base64");
  process.env.OUTBOX_ENCRYPTION_KEY = outboxKey;

  const database = new DatabaseService();
  const auth = new AuthService(database);
  const team = new PlatformTeamService(database, auth);
  const guard = new PlatformAdminGuard(database);
  const suffix = randomBytes(8).toString("hex");
  const actorEmail = `platform-admin-${suffix}@example.test`;
  const invitedEmail = `platform-dev-${suffix}@example.test`;
  const concurrentEmail = `platform-concurrent-${suffix}@example.test`;
  const ownedEmails = [invitedEmail, concurrentEmail];
  const password = "senha-segura-para-equipe";
  const actor = await auth.register({ email: actorEmail, displayName: "Admin", password });
  const invited = await auth.register({ email: invitedEmail, displayName: "Dev", password });
  const identityIds = [actor.identity.id, invited.identity.id];
  process.env.PLATFORM_ADMIN_ROLES = `${actorEmail}=admin`;

  try {
    const actorSession = await database.db
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(eq(authSessions.identityId, actor.identity.id))
      .limit(1);
    const invitedSession = await database.db
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(eq(authSessions.identityId, invited.identity.id))
      .limit(1);
    assert.ok(actorSession[0] && invitedSession[0]);

    const actorSetup = await auth.beginMfaSetup(actor.identity.id);
    const invitedSetup = await auth.beginMfaSetup(invited.identity.id);
    const counter = Math.floor(Date.now() / 30_000);
    await auth.confirmMfaSetup(
      actor.identity.id,
      actorSession[0].id,
      totpCode(actorSetup.secret, counter),
    );
    await auth.confirmMfaSetup(
      invited.identity.id,
      invitedSession[0].id,
      totpCode(invitedSetup.secret, counter),
    );

    const actorRequest = { auth: { identityId: actor.identity.id, email: actorEmail } };
    await assert.rejects(guard.canActivate(contextFor(actorRequest)), (error: unknown) =>
      hasCode(error, "PLATFORM_IDENTITY_NOT_VERIFIED"),
    );
    await database.db
      .update(identities)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(identities.id, actor.identity.id));
    assert.equal(await guard.canActivate(contextFor(actorRequest)), true);

    const noStepUpTeam = new PlatformTeamService(database, {
      verifyStepUp: async () => undefined,
    } as unknown as AuthService);
    const concurrentPayload = {
      email: concurrentEmail,
      role: "support" as const,
      reason: "Convite idempotente simultâneo para suporte",
      reauth: { mfaCode: "000000" },
    };
    const concurrentInviteKey = `concurrent-invite-${suffix}`;
    const concurrentInvites = await Promise.all([
      noStepUpTeam.invite(actor.identity.id, concurrentInviteKey, concurrentPayload),
      noStepUpTeam.invite(actor.identity.id, concurrentInviteKey, concurrentPayload),
    ]);
    assert.deepEqual(concurrentInvites.map((item) => item.replayed).sort(), [false, true]);
    const [concurrentInvitation] = await database.db
      .select()
      .from(platformStaffInvitations)
      .where(eq(platformStaffInvitations.email, concurrentEmail));
    assert.ok(concurrentInvitation);
    assert.equal(
      (
        await database.db
          .select()
          .from(outboxEvents)
          .where(eq(outboxEvents.aggregateId, concurrentInvitation.id))
      ).length,
      1,
    );
    assert.equal(
      (
        await database.db
          .select()
          .from(platformActionReceipts)
          .where(
            and(
              eq(platformActionReceipts.actorIdentityId, actor.identity.id),
              eq(platformActionReceipts.idempotencyKey, concurrentInviteKey),
            ),
          )
      ).length,
      1,
    );
    assert.equal(
      (
        await database.db
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.actorIdentityId, actor.identity.id),
              eq(auditEvents.entityId, concurrentInvitation.id),
            ),
          )
      ).length,
      1,
    );
    const concurrentCancelKey = `concurrent-cancel-${suffix}`;
    const concurrentCancels = await Promise.all([
      noStepUpTeam.cancelInvitation(
        actor.identity.id,
        concurrentInvitation.id,
        concurrentCancelKey,
        { reason: "Cancelar convite idempotente simultâneo", reauth: { mfaCode: "000000" } },
      ),
      noStepUpTeam.cancelInvitation(
        actor.identity.id,
        concurrentInvitation.id,
        concurrentCancelKey,
        { reason: "Cancelar convite idempotente simultâneo", reauth: { mfaCode: "000000" } },
      ),
    ]);
    assert.deepEqual(concurrentCancels.map((item) => item.replayed).sort(), [false, true]);

    const result = await team.invite(actor.identity.id, `invite-${suffix}`, {
      email: invitedEmail,
      role: "engineering",
      reason: "Acesso de desenvolvimento para o piloto",
      reauth: { mfaCode: totpCode(actorSetup.secret, counter - 1) },
    });
    assert.equal(result.replayed, false);
    assert.deepEqual(
      await team.invite(actor.identity.id, `invite-${suffix}`, {
        email: invitedEmail,
        role: "engineering",
        reason: "Acesso de desenvolvimento para o piloto",
        reauth: { mfaCode: "000000" },
      }),
      { ...result, replayed: true },
    );
    await assert.rejects(
      team.invite(actor.identity.id, `invite-${suffix}`, {
        email: invitedEmail,
        role: "support",
        reason: "Acesso de desenvolvimento para o piloto",
        reauth: { mfaCode: "000000" },
      }),
      (error: unknown) => hasCode(error, "PLATFORM_IDEMPOTENCY_KEY_REUSED"),
    );
    await assert.rejects(
      team.invite(actor.identity.id, `invite-${suffix}`, {
        email: invitedEmail,
        role: "engineering",
        reason: "Outro motivo para a mesma chave idempotente",
        reauth: { mfaCode: "000000" },
      }),
      (error: unknown) => hasCode(error, "PLATFORM_IDEMPOTENCY_KEY_REUSED"),
    );

    const [invitation] = await database.db
      .select()
      .from(platformStaffInvitations)
      .where(eq(platformStaffInvitations.email, invitedEmail))
      .limit(1);
    const [event] = await database.db
      .select({ payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.topic, "platform.staff_invited"),
          eq(outboxEvents.aggregateId, invitation?.id ?? ""),
        ),
      )
      .limit(1);
    assert.ok(invitation && event);
    assert.equal(JSON.stringify(event.payload).includes('"token"'), false);
    const envelope = (event.payload as Record<string, unknown>).invitationTokenEnvelope;
    const token = decryptSecret(
      envelope as SecretEnvelope,
      encryptionKey(outboxKey, "OUTBOX_ENCRYPTION_KEY"),
      `platform-staff-invitation:${invitation.tokenHash}`,
    );
    assert.equal(createHash("sha256").update(token).digest("hex"), invitation.tokenHash);

    const accepted = await Promise.allSettled([
      team.accept(invited.identity.id, { token }),
      team.accept(invited.identity.id, { token }),
    ]);
    assert.equal(accepted.filter((item) => item.status === "fulfilled").length, 2);
    const [access] = await database.db
      .select()
      .from(platformStaffAccess)
      .where(eq(platformStaffAccess.identityId, invited.identity.id));
    const [verifiedIdentity] = await database.db
      .select({ emailVerifiedAt: identities.emailVerifiedAt })
      .from(identities)
      .where(eq(identities.id, invited.identity.id));
    assert.equal(access?.role, "engineering");
    assert.ok(verifiedIdentity?.emailVerifiedAt);
    assert.equal((await auth.me(invited.identity.id)).platformAdmin, true);
    assert.equal(
      await guard.canActivate(
        contextFor({ auth: { identityId: invited.identity.id, email: invitedEmail } }),
      ),
      true,
    );

    await team.revokeMember(actor.identity.id, invited.identity.id, `revoke-${suffix}`, {
      reason: "Encerramento do acesso temporário de desenvolvimento",
      reauth: { mfaCode: totpCode(actorSetup.secret, counter + 1) },
    });
    await assert.rejects(
      team.revokeMember(actor.identity.id, invited.identity.id, `revoke-${suffix}`, {
        reason: "Motivo divergente não pode reutilizar a mesma chave",
        reauth: { mfaCode: "000000" },
      }),
      (error: unknown) => hasCode(error, "PLATFORM_IDEMPOTENCY_KEY_REUSED"),
    );
    assert.equal((await auth.me(invited.identity.id)).platformAdmin, false);
    await assert.rejects(
      guard.canActivate(
        contextFor({ auth: { identityId: invited.identity.id, email: invitedEmail } }),
      ),
      (error: unknown) => hasCode(error, "PLATFORM_ACCESS_DENIED"),
    );

    const cancelToken = randomBytes(32).toString("base64url");
    const [cancelInvitation] = await database.db
      .insert(platformStaffInvitations)
      .values({
        email: invitedEmail,
        role: "engineering",
        tokenHash: createHash("sha256").update(cancelToken).digest("hex"),
        invitedByIdentityId: actor.identity.id,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    assert.ok(cancelInvitation);
    const cancelRace = await Promise.allSettled([
      team.accept(invited.identity.id, { token: cancelToken }),
      noStepUpTeam.cancelInvitation(
        actor.identity.id,
        cancelInvitation.id,
        `cancel-race-${suffix}`,
        {
          reason: "Cancelar convite durante teste concorrente",
          reauth: { mfaCode: "000000" },
        },
      ),
    ]);
    assert.equal(cancelRace.filter((item) => item.status === "fulfilled").length, 1);
    const [cancelState] = await database.db
      .select()
      .from(platformStaffInvitations)
      .where(eq(platformStaffInvitations.id, cancelInvitation.id));
    const [cancelAccess] = await database.db
      .select()
      .from(platformStaffAccess)
      .where(
        and(
          eq(platformStaffAccess.identityId, invited.identity.id),
          isNull(platformStaffAccess.revokedAt),
        ),
      );
    assert.notEqual(Boolean(cancelState?.acceptedAt), Boolean(cancelState?.revokedAt));
    assert.equal(Boolean(cancelAccess), Boolean(cancelState?.acceptedAt));

    if (cancelAccess) {
      await database.db
        .update(platformStaffAccess)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(eq(platformStaffAccess.identityId, invited.identity.id));
    }
    const resendToken = randomBytes(32).toString("base64url");
    const [resendInvitation] = await database.db
      .insert(platformStaffInvitations)
      .values({
        email: invitedEmail,
        role: "engineering",
        tokenHash: createHash("sha256").update(resendToken).digest("hex"),
        invitedByIdentityId: actor.identity.id,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    assert.ok(resendInvitation);
    const resendRace = await Promise.allSettled([
      team.accept(invited.identity.id, { token: resendToken }),
      noStepUpTeam.invite(actor.identity.id, `resend-race-${suffix}`, {
        email: invitedEmail,
        role: "support",
        reason: "Reenviar convite durante teste concorrente",
        reauth: { mfaCode: "000000" },
      }),
    ]);
    assert.equal(resendRace.filter((item) => item.status === "fulfilled").length, 1);
    const [resendState] = await database.db
      .select()
      .from(platformStaffInvitations)
      .where(eq(platformStaffInvitations.id, resendInvitation.id));
    const [resendAccess] = await database.db
      .select()
      .from(platformStaffAccess)
      .where(
        and(
          eq(platformStaffAccess.identityId, invited.identity.id),
          isNull(platformStaffAccess.revokedAt),
        ),
      );
    const pendingResend = await database.db
      .select()
      .from(platformStaffInvitations)
      .where(
        and(
          eq(platformStaffInvitations.email, invitedEmail),
          eq(platformStaffInvitations.role, "support"),
          isNull(platformStaffInvitations.acceptedAt),
          isNull(platformStaffInvitations.revokedAt),
        ),
      );
    assert.equal(Boolean(resendAccess), Boolean(resendState?.acceptedAt));
    assert.equal(pendingResend.length, resendState?.acceptedAt ? 0 : 1);
  } finally {
    await database.db
      .delete(platformActionReceipts)
      .where(inArray(platformActionReceipts.actorIdentityId, identityIds));
    await database.db.delete(auditEvents).where(inArray(auditEvents.actorIdentityId, identityIds));
    const ownedInvitations = await database.db
      .select({ id: platformStaffInvitations.id })
      .from(platformStaffInvitations)
      .where(inArray(platformStaffInvitations.email, ownedEmails));
    if (ownedInvitations.length) {
      await database.db.delete(outboxEvents).where(
        inArray(
          outboxEvents.aggregateId,
          ownedInvitations.map((item) => item.id),
        ),
      );
    }
    await database.db
      .delete(platformStaffInvitations)
      .where(inArray(platformStaffInvitations.email, ownedEmails));
    await database.db
      .delete(platformStaffAccess)
      .where(inArray(platformStaffAccess.identityId, identityIds));
    await database.db.delete(identities).where(inArray(identities.id, identityIds));
    await database.onModuleDestroy();
    process.env.DATABASE_URL = previous.databaseUrl;
    process.env.EMAIL_PROVIDER_ENABLED = previous.emailProviderEnabled;
    process.env.MFA_ENCRYPTION_KEY = previous.mfaKey;
    process.env.OUTBOX_ENCRYPTION_KEY = previous.outboxKey;
    process.env.PLATFORM_ADMIN_ROLES = previous.roles;
  }
});
