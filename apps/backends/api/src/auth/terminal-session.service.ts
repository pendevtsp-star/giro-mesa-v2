import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  auditEvents,
  authSessions,
  identities,
  managementPeople,
  managementPersonAccess,
  memberships,
  organizations,
  passwordCredentials,
  roleBindings,
  terminalOperatorPins,
  terminalSessions,
  units,
} from "@giromesa/db";
import {
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import type { AuthContext } from "./auth.service.js";

export const TERMINAL_SESSION_TTL_MS = 12 * 60 * 60 * 1_000;
export const TERMINAL_IDLE_TIMEOUT_MS = 5 * 60 * 1_000;
export const TERMINAL_LOCKOUT_MS = 15 * 60 * 1_000;
export const TERMINAL_MAX_FAILED_ATTEMPTS = 5;

export function nextTerminalPinFailure(
  failedAttempts: number,
  failureWindowStartedAt: Date | null,
  now: Date,
) {
  const inWindow =
    failureWindowStartedAt !== null &&
    failureWindowStartedAt.getTime() > now.getTime() - TERMINAL_LOCKOUT_MS;
  const attempts = inWindow ? failedAttempts + 1 : 1;
  return {
    attempts,
    failureWindowStartedAt: inWindow ? failureWindowStartedAt : now,
    lockedUntil:
      attempts >= TERMINAL_MAX_FAILED_ATTEMPTS
        ? new Date(now.getTime() + TERMINAL_LOCKOUT_MS)
        : null,
  };
}

export interface TerminalOperatorView {
  membershipId: string;
  identityId: string;
  displayName: string;
  roles: string[];
}

export interface TerminalSessionView {
  id: string;
  deviceId: string | null;
  organization: { id: string; name: string; document: string };
  unit: { id: string; name: string; timezone: string };
  expiresAt: string;
  idleTimeoutSeconds: number;
  actorEpoch: number;
  lockedUntil: string | null;
  operators: TerminalOperatorView[];
  actor: TerminalOperatorView | null;
}

export interface ManagedTerminalSession {
  id: string;
  deviceId: string | null;
  openedBy: string;
  activeOperator: string | null;
  status: "waiting" | "active" | "locked";
  createdAt: string;
  lastActivityAt: string | null;
  lockedUntil: string | null;
  expiresAt: string;
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

function pinPepper() {
  const value = process.env.TERMINAL_PIN_PEPPER?.trim();
  if (!value || value.length < 32) {
    throw new ServiceUnavailableException({
      code: "TERMINAL_PIN_NOT_CONFIGURED",
      message: "A troca rápida por PIN ainda não foi configurada neste ambiente.",
    });
  }
  return value;
}

function protectedPin(membershipId: string, pin: string) {
  return createHmac("sha256", pinPepper()).update(`${membershipId}:${pin}`).digest("base64url");
}

function terminalLocked(lockedUntil?: Date | null) {
  return new HttpException(
    {
      code: "TERMINAL_PIN_LOCKED",
      message: "Muitas tentativas inválidas. Aguarde antes de tentar novamente.",
      lockedUntil: lockedUntil?.toISOString(),
    },
    429,
  );
}

@Injectable()
export class TerminalSessionService {
  constructor(private readonly database: DatabaseService) {}

  async configurePin(
    identityId: string,
    input: { membershipId: string; currentPassword: string; pin: string },
  ) {
    const [membership] = await this.database.db
      .select({
        id: memberships.id,
        organizationId: memberships.organizationId,
        passwordHash: passwordCredentials.passwordHash,
      })
      .from(memberships)
      .innerJoin(identities, eq(identities.id, memberships.identityId))
      .leftJoin(passwordCredentials, eq(passwordCredentials.identityId, identities.id))
      .where(
        and(
          eq(memberships.id, input.membershipId),
          eq(memberships.identityId, identityId),
          eq(memberships.status, "active"),
          isNull(identities.disabledAt),
        ),
      )
      .limit(1);
    const validPassword = membership?.passwordHash
      ? await argon2.verify(membership.passwordHash, input.currentPassword)
      : false;
    if (!membership || !validPassword) {
      if (!membership?.passwordHash) await argon2.hash(input.currentPassword);
      throw new UnauthorizedException({
        code: "TERMINAL_PIN_REAUTH_REQUIRED",
        message: "Confirme sua senha atual para configurar o PIN.",
      });
    }

    const pinHash = await argon2.hash(protectedPin(membership.id, input.pin), {
      type: argon2.argon2id,
    });
    await this.database.db.transaction(async (tx) => {
      await tx
        .insert(terminalOperatorPins)
        .values({ membershipId: membership.id, pinHash })
        .onConflictDoUpdate({
          target: terminalOperatorPins.membershipId,
          set: { pinHash, active: true, updatedAt: new Date() },
        });
      await tx.insert(auditEvents).values({
        organizationId: membership.organizationId,
        actorIdentityId: identityId,
        action: "auth.terminal_pin.updated",
        entityType: "membership",
        entityId: membership.id,
      });
    });
    return { configured: true };
  }

  async revokePin(identityId: string, membershipId: string) {
    const [membership] = await this.database.db
      .select({ organizationId: memberships.organizationId })
      .from(memberships)
      .where(and(eq(memberships.id, membershipId), eq(memberships.identityId, identityId)))
      .limit(1);
    if (!membership) throw new ForbiddenException({ code: "TERMINAL_PIN_DENIED" });
    await this.database.db.transaction(async (tx) => {
      await tx
        .update(terminalOperatorPins)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(terminalOperatorPins.membershipId, membershipId));
      await tx
        .update(terminalSessions)
        .set({
          activeActorMembershipId: null,
          actorEpoch: sql`${terminalSessions.actorEpoch} + 1`,
          lastActivityAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(terminalSessions.activeActorMembershipId, membershipId),
            isNull(terminalSessions.revokedAt),
          ),
        );
      await tx.insert(auditEvents).values({
        organizationId: membership.organizationId,
        actorIdentityId: identityId,
        action: "auth.terminal_pin.revoked",
        entityType: "membership",
        entityId: membershipId,
      });
    });
  }

  async create(
    auth: AuthContext,
    input: { organizationId: string; unitId: string; deviceId?: string },
  ) {
    if (auth.authKind === "terminal") throw new ForbiddenException({ code: "IDENTITY_REQUIRED" });
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + TERMINAL_SESSION_TTL_MS);
    const session = await this.database.db.transaction(async (tx) => {
      const [authorized] = await tx
        .select({ membershipId: memberships.id })
        .from(memberships)
        .innerJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
        .innerJoin(
          units,
          and(eq(units.id, input.unitId), eq(units.organizationId, input.organizationId)),
        )
        .where(
          and(
            eq(memberships.identityId, auth.identityId),
            eq(memberships.organizationId, input.organizationId),
            eq(memberships.status, "active"),
            eq(units.active, true),
            or(isNull(roleBindings.unitId), eq(roleBindings.unitId, input.unitId)),
            or(eq(roleBindings.role, "owner"), eq(roleBindings.role, "manager")),
          ),
        )
        .limit(1);
      if (!authorized) {
        throw new ForbiddenException({
          code: "TERMINAL_SESSION_DENIED",
          message: "Somente proprietários e gerentes podem ativar um terminal compartilhado.",
        });
      }
      const [revoked] = await tx
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(authSessions.id, auth.sessionId),
            eq(authSessions.identityId, auth.identityId),
            isNull(authSessions.revokedAt),
          ),
        )
        .returning({ id: authSessions.id });
      if (!revoked) throw new UnauthorizedException();
      const [created] = await tx
        .insert(terminalSessions)
        .values({
          tokenHash: tokenHash(token),
          organizationId: input.organizationId,
          unitId: input.unitId,
          openedByIdentityId: auth.identityId,
          deviceId: input.deviceId,
          expiresAt,
        })
        .returning({ id: terminalSessions.id });
      if (!created) throw new Error("Terminal session was not created");
      await tx.insert(auditEvents).values({
        organizationId: input.organizationId,
        unitId: input.unitId,
        actorIdentityId: auth.identityId,
        action: "auth.terminal.created",
        entityType: "terminal_session",
        entityId: created.id,
        metadata: input.deviceId ? { deviceId: input.deviceId } : {},
      });
      return created;
    });
    return { token, expiresAt, sessionId: session.id, view: await this.status(token) };
  }

  async status(token: string): Promise<TerminalSessionView> {
    let terminal = await this.requireTerminal(token);
    if (
      terminal.activeActorMembershipId &&
      (!terminal.lastActivityAt ||
        terminal.lastActivityAt.getTime() <= Date.now() - TERMINAL_IDLE_TIMEOUT_MS)
    ) {
      await this.lock(token, "idle_timeout");
      terminal = await this.requireTerminal(token);
    }
    const operators = await this.operatorsFor(terminal.organizationId, terminal.unitId);
    return this.toView(terminal, operators);
  }

  async unlock(token: string, membershipId: string, pin: string) {
    const now = new Date();
    const failure = await this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from terminal_sessions where token_hash=${tokenHash(token)} for update`,
      );
      const [terminal] = await tx
        .select()
        .from(terminalSessions)
        .where(
          and(
            eq(terminalSessions.tokenHash, tokenHash(token)),
            isNull(terminalSessions.revokedAt),
            gt(terminalSessions.expiresAt, now),
          ),
        )
        .limit(1);
      if (!terminal) throw new UnauthorizedException({ code: "TERMINAL_SESSION_INVALID" });
      if (terminal.lockedUntil && terminal.lockedUntil > now)
        throw terminalLocked(terminal.lockedUntil);

      const [operator] = await tx
        .select({
          membershipId: memberships.id,
          identityId: identities.id,
          pinHash: terminalOperatorPins.pinHash,
        })
        .from(memberships)
        .innerJoin(identities, eq(identities.id, memberships.identityId))
        .innerJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
        .innerJoin(
          managementPersonAccess,
          and(
            eq(managementPersonAccess.membershipId, memberships.id),
            eq(managementPersonAccess.organizationId, terminal.organizationId),
            eq(managementPersonAccess.unitId, terminal.unitId),
            eq(managementPersonAccess.status, "active"),
          ),
        )
        .innerJoin(
          managementPeople,
          and(
            eq(managementPeople.id, managementPersonAccess.personId),
            eq(managementPeople.organizationId, terminal.organizationId),
            eq(managementPeople.identityId, identities.id),
            eq(managementPeople.active, true),
          ),
        )
        .innerJoin(terminalOperatorPins, eq(terminalOperatorPins.membershipId, memberships.id))
        .where(
          and(
            eq(memberships.id, membershipId),
            eq(memberships.organizationId, terminal.organizationId),
            eq(memberships.status, "active"),
            isNull(identities.disabledAt),
            eq(terminalOperatorPins.active, true),
            or(isNull(roleBindings.unitId), eq(roleBindings.unitId, terminal.unitId)),
          ),
        )
        .limit(1);
      let valid = false;
      try {
        valid = operator
          ? await argon2.verify(operator.pinHash, protectedPin(operator.membershipId, pin))
          : false;
      } catch {
        valid = false;
      }
      if (!operator) await argon2.hash(protectedPin(membershipId, pin));

      if (!operator || !valid) {
        const nextFailure = nextTerminalPinFailure(
          terminal.failedAttempts,
          terminal.failureWindowStartedAt,
          now,
        );
        await tx
          .update(terminalSessions)
          .set({
            failedAttempts: nextFailure.attempts,
            failureWindowStartedAt: nextFailure.failureWindowStartedAt,
            lockedUntil: nextFailure.lockedUntil,
            ...(nextFailure.lockedUntil
              ? {
                  activeActorMembershipId: null,
                  actorEpoch: sql`${terminalSessions.actorEpoch} + 1`,
                  lastActivityAt: null,
                }
              : {}),
            updatedAt: now,
          })
          .where(eq(terminalSessions.id, terminal.id));
        await tx.insert(auditEvents).values({
          organizationId: terminal.organizationId,
          unitId: terminal.unitId,
          action: "auth.terminal.pin_failed",
          entityType: "terminal_session",
          entityId: terminal.id,
          metadata: {
            membershipId,
            attempts: nextFailure.attempts,
            locked: Boolean(nextFailure.lockedUntil),
          },
        });
        return nextFailure;
      }

      await tx
        .update(terminalSessions)
        .set({
          activeActorMembershipId: operator.membershipId,
          actorEpoch: sql`${terminalSessions.actorEpoch} + 1`,
          lastActivityAt: now,
          failedAttempts: 0,
          failureWindowStartedAt: null,
          lockedUntil: null,
          updatedAt: now,
        })
        .where(eq(terminalSessions.id, terminal.id));
      await tx.insert(auditEvents).values({
        organizationId: terminal.organizationId,
        unitId: terminal.unitId,
        actorIdentityId: operator.identityId,
        action: terminal.activeActorMembershipId
          ? "auth.terminal.operator_switched"
          : "auth.terminal.operator_unlocked",
        entityType: "terminal_session",
        entityId: terminal.id,
        metadata: {
          previousMembershipId: terminal.activeActorMembershipId,
          membershipId: operator.membershipId,
          actorEpoch: terminal.actorEpoch + 1,
        },
      });
      return null;
    });
    if (failure?.lockedUntil) throw terminalLocked(failure.lockedUntil);
    if (failure) {
      throw new UnauthorizedException({
        code: "INVALID_TERMINAL_PIN",
        message: "Operador ou PIN inválido.",
      });
    }
    return this.status(token);
  }

  async activity(token: string, actorEpoch: number) {
    const now = new Date();
    const [updated] = await this.database.db
      .update(terminalSessions)
      .set({ lastActivityAt: now, updatedAt: now })
      .where(
        and(
          eq(terminalSessions.tokenHash, tokenHash(token)),
          eq(terminalSessions.actorEpoch, actorEpoch),
          isNull(terminalSessions.revokedAt),
          gt(terminalSessions.expiresAt, now),
          gt(terminalSessions.lastActivityAt, new Date(now.getTime() - TERMINAL_IDLE_TIMEOUT_MS)),
          isNull(terminalSessions.lockedUntil),
        ),
      )
      .returning({ id: terminalSessions.id });
    if (!updated) {
      throw new UnauthorizedException({
        code: "TERMINAL_LOCKED",
        message: "O terminal foi bloqueado por inatividade ou troca de operador.",
      });
    }
    return { active: true };
  }

  async lock(token: string, reason = "manual") {
    const terminal = await this.requireTerminal(token);
    const actor = terminal.activeActorMembershipId
      ? await this.identityForMembership(terminal.activeActorMembershipId, terminal.organizationId)
      : null;
    if (terminal.activeActorMembershipId) {
      await this.database.db.transaction(async (tx) => {
        await tx
          .update(terminalSessions)
          .set({
            activeActorMembershipId: null,
            actorEpoch: sql`${terminalSessions.actorEpoch} + 1`,
            lastActivityAt: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(terminalSessions.id, terminal.id),
              eq(terminalSessions.actorEpoch, terminal.actorEpoch),
            ),
          );
        await tx.insert(auditEvents).values({
          organizationId: terminal.organizationId,
          unitId: terminal.unitId,
          actorIdentityId: actor?.identityId,
          action: "auth.terminal.locked",
          entityType: "terminal_session",
          entityId: terminal.id,
          metadata: { reason, actorEpoch: terminal.actorEpoch },
        });
      });
    }
    return this.statusWithoutIdleCheck(token);
  }

  async close(token: string) {
    const [terminal] = await this.database.db
      .select()
      .from(terminalSessions)
      .where(
        and(eq(terminalSessions.tokenHash, tokenHash(token)), isNull(terminalSessions.revokedAt)),
      )
      .limit(1);
    if (!terminal) return;
    const actor = terminal.activeActorMembershipId
      ? await this.identityForMembership(terminal.activeActorMembershipId, terminal.organizationId)
      : null;
    await this.database.db.transaction(async (tx) => {
      await tx
        .update(terminalSessions)
        .set({
          revokedAt: new Date(),
          activeActorMembershipId: null,
          actorEpoch: sql`${terminalSessions.actorEpoch} + 1`,
          lastActivityAt: null,
          updatedAt: new Date(),
        })
        .where(eq(terminalSessions.id, terminal.id));
      await tx.insert(auditEvents).values({
        organizationId: terminal.organizationId,
        unitId: terminal.unitId,
        actorIdentityId: actor?.identityId ?? terminal.openedByIdentityId,
        action: "auth.terminal.revoked",
        entityType: "terminal_session",
        entityId: terminal.id,
      });
    });
  }

  async listForScope(organizationId: string, unitId: string): Promise<ManagedTerminalSession[]> {
    const now = new Date();
    const sessions = await this.database.db
      .select()
      .from(terminalSessions)
      .where(
        and(
          eq(terminalSessions.organizationId, organizationId),
          eq(terminalSessions.unitId, unitId),
          isNull(terminalSessions.revokedAt),
          gt(terminalSessions.expiresAt, now),
        ),
      )
      .orderBy(desc(terminalSessions.createdAt));
    if (!sessions.length) return [];

    const openerIds = [...new Set(sessions.map((session) => session.openedByIdentityId))];
    const actorIds = [
      ...new Set(
        sessions
          .map((session) => session.activeActorMembershipId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const [openers, actors] = await Promise.all([
      this.database.db
        .select({ id: identities.id, name: identities.displayName })
        .from(identities)
        .where(inArray(identities.id, openerIds)),
      actorIds.length
        ? this.database.db
            .select({ id: memberships.id, name: identities.displayName })
            .from(memberships)
            .innerJoin(identities, eq(identities.id, memberships.identityId))
            .where(inArray(memberships.id, actorIds))
        : Promise.resolve([]),
    ]);
    const openerNames = new Map(openers.map((identity) => [identity.id, identity.name]));
    const actorNames = new Map(actors.map((membership) => [membership.id, membership.name]));

    return sessions.map((session) => ({
      id: session.id,
      deviceId: session.deviceId,
      openedBy: openerNames.get(session.openedByIdentityId) ?? "Usuário removido",
      activeOperator: session.activeActorMembershipId
        ? (actorNames.get(session.activeActorMembershipId) ?? "Operador removido")
        : null,
      status:
        session.lockedUntil && session.lockedUntil > now
          ? "locked"
          : session.activeActorMembershipId
            ? "active"
            : "waiting",
      createdAt: session.createdAt.toISOString(),
      lastActivityAt: session.lastActivityAt?.toISOString() ?? null,
      lockedUntil:
        session.lockedUntil && session.lockedUntil > now ? session.lockedUntil.toISOString() : null,
      expiresAt: session.expiresAt.toISOString(),
    }));
  }

  async revokeForScope(
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    terminalSessionId: string,
    reason: string,
  ) {
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from terminal_sessions where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${terminalSessionId}::uuid for update`,
      );
      const [terminal] = await tx
        .select({ id: terminalSessions.id, revokedAt: terminalSessions.revokedAt })
        .from(terminalSessions)
        .where(
          and(
            eq(terminalSessions.id, terminalSessionId),
            eq(terminalSessions.organizationId, organizationId),
            eq(terminalSessions.unitId, unitId),
          ),
        )
        .limit(1);
      if (!terminal) throw new NotFoundException({ code: "TERMINAL_SESSION_NOT_FOUND" });
      if (terminal.revokedAt) return { revoked: true };
      const revokedAt = new Date();
      await tx
        .update(terminalSessions)
        .set({
          revokedAt,
          activeActorMembershipId: null,
          actorEpoch: sql`${terminalSessions.actorEpoch} + 1`,
          lastActivityAt: null,
          updatedAt: revokedAt,
        })
        .where(eq(terminalSessions.id, terminalSessionId));
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId,
        action: "auth.terminal.revoked_remotely",
        entityType: "terminal_session",
        entityId: terminalSessionId,
        metadata: { reason },
      });
      return { revoked: true };
    });
  }

  async authenticate(token: string): Promise<AuthContext | null> {
    const now = new Date();
    const [record] = await this.database.db
      .select({
        sessionId: terminalSessions.id,
        identityId: identities.id,
        email: identities.email,
        displayName: identities.displayName,
        expiresAt: terminalSessions.expiresAt,
        organizationId: terminalSessions.organizationId,
        unitId: terminalSessions.unitId,
        actorEpoch: terminalSessions.actorEpoch,
      })
      .from(terminalSessions)
      .innerJoin(memberships, eq(memberships.id, terminalSessions.activeActorMembershipId))
      .innerJoin(identities, eq(identities.id, memberships.identityId))
      .innerJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
      .innerJoin(
        managementPersonAccess,
        and(
          eq(managementPersonAccess.membershipId, memberships.id),
          eq(managementPersonAccess.organizationId, terminalSessions.organizationId),
          eq(managementPersonAccess.unitId, terminalSessions.unitId),
          eq(managementPersonAccess.status, "active"),
        ),
      )
      .innerJoin(
        managementPeople,
        and(
          eq(managementPeople.id, managementPersonAccess.personId),
          eq(managementPeople.organizationId, terminalSessions.organizationId),
          eq(managementPeople.identityId, identities.id),
          eq(managementPeople.active, true),
        ),
      )
      .innerJoin(terminalOperatorPins, eq(terminalOperatorPins.membershipId, memberships.id))
      .where(
        and(
          eq(terminalSessions.tokenHash, tokenHash(token)),
          isNull(terminalSessions.revokedAt),
          gt(terminalSessions.expiresAt, now),
          gt(terminalSessions.lastActivityAt, new Date(now.getTime() - TERMINAL_IDLE_TIMEOUT_MS)),
          eq(memberships.organizationId, terminalSessions.organizationId),
          eq(memberships.status, "active"),
          isNull(identities.disabledAt),
          eq(terminalOperatorPins.active, true),
          or(isNull(roleBindings.unitId), eq(roleBindings.unitId, terminalSessions.unitId)),
        ),
      )
      .limit(1);
    return record ? { ...record, authKind: "terminal" } : null;
  }

  private async requireTerminal(token: string) {
    const [terminal] = await this.database.db
      .select({
        id: terminalSessions.id,
        deviceId: terminalSessions.deviceId,
        organizationId: terminalSessions.organizationId,
        unitId: terminalSessions.unitId,
        openedByIdentityId: terminalSessions.openedByIdentityId,
        activeActorMembershipId: terminalSessions.activeActorMembershipId,
        actorEpoch: terminalSessions.actorEpoch,
        lastActivityAt: terminalSessions.lastActivityAt,
        failedAttempts: terminalSessions.failedAttempts,
        failureWindowStartedAt: terminalSessions.failureWindowStartedAt,
        lockedUntil: terminalSessions.lockedUntil,
        expiresAt: terminalSessions.expiresAt,
        organizationName: organizations.tradeName,
        organizationDocument: organizations.document,
        unitName: units.name,
        unitTimezone: units.timezone,
      })
      .from(terminalSessions)
      .innerJoin(organizations, eq(organizations.id, terminalSessions.organizationId))
      .innerJoin(units, eq(units.id, terminalSessions.unitId))
      .where(
        and(
          eq(terminalSessions.tokenHash, tokenHash(token)),
          isNull(terminalSessions.revokedAt),
          gt(terminalSessions.expiresAt, new Date()),
          eq(units.active, true),
        ),
      )
      .limit(1);
    if (!terminal) throw new UnauthorizedException({ code: "TERMINAL_SESSION_INVALID" });
    return terminal;
  }

  private async statusWithoutIdleCheck(token: string): Promise<TerminalSessionView> {
    const terminal = await this.requireTerminal(token);
    return this.toView(terminal, await this.operatorsFor(terminal.organizationId, terminal.unitId));
  }

  private async operatorsFor(organizationId: string, unitId: string) {
    const rows = await this.database.db
      .select({
        membershipId: memberships.id,
        identityId: identities.id,
        displayName: identities.displayName,
        role: roleBindings.role,
      })
      .from(memberships)
      .innerJoin(identities, eq(identities.id, memberships.identityId))
      .innerJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
      .innerJoin(
        managementPersonAccess,
        and(
          eq(managementPersonAccess.membershipId, memberships.id),
          eq(managementPersonAccess.organizationId, organizationId),
          eq(managementPersonAccess.unitId, unitId),
          eq(managementPersonAccess.status, "active"),
        ),
      )
      .innerJoin(
        managementPeople,
        and(
          eq(managementPeople.id, managementPersonAccess.personId),
          eq(managementPeople.organizationId, organizationId),
          eq(managementPeople.identityId, identities.id),
          eq(managementPeople.active, true),
        ),
      )
      .innerJoin(terminalOperatorPins, eq(terminalOperatorPins.membershipId, memberships.id))
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          isNull(identities.disabledAt),
          eq(terminalOperatorPins.active, true),
          or(isNull(roleBindings.unitId), eq(roleBindings.unitId, unitId)),
        ),
      );
    const operators = new Map<string, TerminalOperatorView>();
    for (const row of rows) {
      const current = operators.get(row.membershipId) ?? {
        membershipId: row.membershipId,
        identityId: row.identityId,
        displayName: row.displayName,
        roles: [],
      };
      if (!current.roles.includes(row.role)) current.roles.push(row.role);
      operators.set(row.membershipId, current);
    }
    return [...operators.values()].sort((left, right) =>
      left.displayName.localeCompare(right.displayName, "pt-BR"),
    );
  }

  private async identityForMembership(membershipId: string, organizationId: string) {
    const [identity] = await this.database.db
      .select({ identityId: memberships.identityId })
      .from(memberships)
      .where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, organizationId)))
      .limit(1);
    return identity ?? null;
  }

  private toView(
    terminal: Awaited<ReturnType<TerminalSessionService["requireTerminal"]>>,
    operators: TerminalOperatorView[],
  ): TerminalSessionView {
    return {
      id: terminal.id,
      deviceId: terminal.deviceId,
      organization: {
        id: terminal.organizationId,
        name: terminal.organizationName,
        document: terminal.organizationDocument,
      },
      unit: {
        id: terminal.unitId,
        name: terminal.unitName,
        timezone: terminal.unitTimezone,
      },
      expiresAt: terminal.expiresAt.toISOString(),
      idleTimeoutSeconds: TERMINAL_IDLE_TIMEOUT_MS / 1_000,
      actorEpoch: terminal.actorEpoch,
      lockedUntil:
        terminal.lockedUntil && terminal.lockedUntil > new Date()
          ? terminal.lockedUntil.toISOString()
          : null,
      operators,
      actor:
        operators.find((operator) => operator.membershipId === terminal.activeActorMembershipId) ??
        null,
    };
  }
}
