import { createHash } from "node:crypto";
import {
  idempotencyKeySchema,
  type PrivacyDecisionInput,
  type PrivacyRequestInput,
} from "@giromesa/contracts";
import {
  auditEvents,
  outboxEvents,
  privacyExports,
  privacyRequestSteps,
  privacyRequests,
} from "@giromesa/db";
import {
  decryptSecret,
  encryptionKey,
  PRIVACY_REQUIRED_DOMAINS,
  privacyExecutionPlan,
  redactPrivacyMetadata,
} from "@giromesa/domain";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AuthContext } from "../auth/auth.service.js";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";

const ALL_ORGANIZATION_ROLES = [
  "owner",
  "manager",
  "waiter",
  "cashier",
  "kds",
  "inventory",
  "finance",
] as const;
const STEP_UP_TTL_MS = 10 * 60_000;
const LOCAL_PROCESSORS = new Set(PRIVACY_REQUIRED_DOMAINS);

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function requireRecentStepUp(auth: AuthContext) {
  if (!auth.mfaVerifiedAt || Date.now() - auth.mfaVerifiedAt.valueOf() > STEP_UP_TTL_MS) {
    throw new ForbiddenException({
      code: "PRIVACY_STEP_UP_REQUIRED",
      message: "Confirme novamente o MFA para continuar.",
    });
  }
}

function exportKey() {
  try {
    return encryptionKey(
      process.env.PRIVACY_EXPORT_ENCRYPTION_KEY,
      "PRIVACY_EXPORT_ENCRYPTION_KEY",
    );
  } catch {
    throw new ServiceUnavailableException({
      code: "PRIVACY_EXPORT_UNAVAILABLE",
      message: "A exportação protegida não está configurada.",
    });
  }
}

@Injectable()
export class PrivacyService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
  ) {}

  async create(
    auth: AuthContext,
    organizationId: string,
    idempotencyKey: string,
    input: PrivacyRequestInput,
  ) {
    const parsedKey = idempotencyKeySchema.safeParse(idempotencyKey);
    if (!parsedKey.success) {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_INVALID",
        message: "Informe uma chave de idempotência válida.",
      });
    }
    idempotencyKey = parsedKey.data;
    await this.scope.requireOrganizationRole(
      auth.identityId,
      organizationId,
      ALL_ORGANIZATION_ROLES,
    );
    const requestFingerprint = fingerprint(input);
    const plan = privacyExecutionPlan(LOCAL_PROCESSORS);
    return this.database.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(privacyRequests)
        .values({
          organizationId,
          subjectIdentityId: auth.identityId,
          requesterIdentityId: auth.identityId,
          type: input.type,
          idempotencyKey,
          requestFingerprint,
          requestPayload: input,
          requiredDomains: [...PRIVACY_REQUIRED_DOMAINS],
        })
        .onConflictDoNothing({
          target: [privacyRequests.organizationId, privacyRequests.idempotencyKey],
        })
        .returning();
      const request =
        created ??
        (
          await tx
            .select()
            .from(privacyRequests)
            .where(
              and(
                eq(privacyRequests.organizationId, organizationId),
                eq(privacyRequests.idempotencyKey, idempotencyKey),
              ),
            )
            .limit(1)
        )[0];
      if (!request) throw new Error("Privacy request was not created");
      if (request.requestFingerprint !== requestFingerprint) {
        throw new ConflictException({
          code: "PRIVACY_IDEMPOTENCY_CONFLICT",
          message: "A chave de idempotência já foi usada com outros dados.",
        });
      }
      if (created) {
        await tx.insert(privacyRequestSteps).values(
          plan.steps.map((step) => ({
            organizationId,
            requestId: request.id,
            domain: step.domain,
            mandatory: step.mandatory,
            status: step.status,
            reasonCode: step.reasonCode,
          })),
        );
        await tx.insert(auditEvents).values({
          organizationId,
          actorIdentityId: auth.identityId,
          action: "privacy.request_created",
          entityType: "privacy_request",
          entityId: request.id,
          metadata: redactPrivacyMetadata({ requestType: input.type, state: request.state }),
        });
      }
      return this.status(auth.identityId, organizationId, request.id, tx);
    });
  }

  async list(identityId: string, organizationId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, ALL_ORGANIZATION_ROLES);
    const rows = await this.database.db
      .select()
      .from(privacyRequests)
      .where(eq(privacyRequests.organizationId, organizationId))
      .orderBy(desc(privacyRequests.createdAt));
    return Promise.all(rows.map((row) => this.status(identityId, organizationId, row.id)));
  }

  async get(identityId: string, organizationId: string, requestId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, ALL_ORGANIZATION_ROLES);
    return this.status(identityId, organizationId, requestId);
  }

  async verify(auth: AuthContext, organizationId: string, requestId: string) {
    requireRecentStepUp(auth);
    await this.scope.requireOrganizationRole(
      auth.identityId,
      organizationId,
      ALL_ORGANIZATION_ROLES,
    );
    await this.database.db.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(privacyRequests)
        .where(
          and(
            eq(privacyRequests.organizationId, organizationId),
            eq(privacyRequests.id, requestId),
            eq(privacyRequests.requesterIdentityId, auth.identityId),
          ),
        )
        .limit(1);
      if (!request) throw this.notFound();
      if (request.state === "approval_pending") return;
      if (request.state !== "verification_pending") throw this.stateConflict(request.state);
      const [updated] = await tx
        .update(privacyRequests)
        .set({ state: "approval_pending", verifiedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(privacyRequests.organizationId, organizationId),
            eq(privacyRequests.id, requestId),
            eq(privacyRequests.state, "verification_pending"),
          ),
        )
        .returning({ id: privacyRequests.id });
      if (!updated) throw this.stateConflict("concurrent_update");
      await tx.insert(auditEvents).values({
        organizationId,
        actorIdentityId: auth.identityId,
        action: "privacy.subject_verified",
        entityType: "privacy_request",
        entityId: requestId,
        metadata: redactPrivacyMetadata({ state: "approval_pending" }),
      });
    });
    return this.status(auth.identityId, organizationId, requestId);
  }

  async approve(auth: AuthContext, organizationId: string, requestId: string) {
    requireRecentStepUp(auth);
    await this.scope.requireOrganizationRole(auth.identityId, organizationId, ["owner"]);
    await this.queue(auth, organizationId, requestId, ["approval_pending"], "privacy.approved");
    return this.status(auth.identityId, organizationId, requestId);
  }

  async retry(auth: AuthContext, organizationId: string, requestId: string) {
    requireRecentStepUp(auth);
    await this.scope.requireOrganizationRole(auth.identityId, organizationId, ["owner"]);
    await this.queue(auth, organizationId, requestId, ["partial", "failed"], "privacy.retried");
    return this.status(auth.identityId, organizationId, requestId);
  }

  async reject(
    auth: AuthContext,
    organizationId: string,
    requestId: string,
    _decision: PrivacyDecisionInput,
  ) {
    requireRecentStepUp(auth);
    await this.scope.requireOrganizationRole(auth.identityId, organizationId, ["owner"]);
    const [updated] = await this.database.db
      .update(privacyRequests)
      .set({ state: "rejected", rejectedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(privacyRequests.organizationId, organizationId),
          eq(privacyRequests.id, requestId),
          inArray(privacyRequests.state, [
            "verification_pending",
            "approval_pending",
            "partial",
            "failed",
          ]),
        ),
      )
      .returning({ id: privacyRequests.id });
    if (!updated) throw this.stateConflict("terminal_or_missing");
    await this.database.db.insert(auditEvents).values({
      organizationId,
      actorIdentityId: auth.identityId,
      action: "privacy.rejected",
      entityType: "privacy_request",
      entityId: requestId,
      metadata: redactPrivacyMetadata({ state: "rejected" }),
    });
    return this.status(auth.identityId, organizationId, requestId);
  }

  async download(auth: AuthContext, organizationId: string, requestId: string) {
    requireRecentStepUp(auth);
    await this.scope.requireOrganizationRole(
      auth.identityId,
      organizationId,
      ALL_ORGANIZATION_ROLES,
    );
    const key = exportKey();
    const [claimed] = await this.database.db
      .update(privacyExports)
      .set({ downloadedAt: new Date() })
      .where(
        and(
          eq(privacyExports.organizationId, organizationId),
          eq(privacyExports.requestId, requestId),
          eq(privacyExports.subjectIdentityId, auth.identityId),
          isNull(privacyExports.downloadedAt),
          sql`${privacyExports.expiresAt} > now()`,
        ),
      )
      .returning();
    if (!claimed) {
      throw new GoneException({
        code: "PRIVACY_EXPORT_EXPIRED_OR_USED",
        message: "A exportação expirou ou já foi baixada.",
      });
    }
    const plaintext = decryptSecret(
      {
        encryptedSecret: claimed.encryptedPayload,
        iv: claimed.iv,
        authTag: claimed.authTag,
      },
      key,
      `privacy-export:${organizationId}:${requestId}:${auth.identityId}`,
    );
    await this.database.db.insert(auditEvents).values({
      organizationId,
      actorIdentityId: auth.identityId,
      action: "privacy.export_downloaded",
      entityType: "privacy_request",
      entityId: requestId,
      metadata: {},
    });
    return JSON.parse(plaintext) as Record<string, unknown>;
  }

  private async queue(
    auth: AuthContext,
    organizationId: string,
    requestId: string,
    expectedStates: Array<"approval_pending" | "partial" | "failed">,
    action: string,
  ) {
    await this.database.db.transaction(async (tx) => {
      const [request] = await tx
        .update(privacyRequests)
        .set({
          state: "processing",
          approvedAt: new Date(),
          attempts: sql`${privacyRequests.attempts} + 1`,
          lastErrorCode: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(privacyRequests.organizationId, organizationId),
            eq(privacyRequests.id, requestId),
            inArray(privacyRequests.state, expectedStates),
          ),
        )
        .returning({ attempts: privacyRequests.attempts, type: privacyRequests.type });
      if (!request) {
        const [current] = await tx
          .select({ state: privacyRequests.state })
          .from(privacyRequests)
          .where(
            and(
              eq(privacyRequests.organizationId, organizationId),
              eq(privacyRequests.id, requestId),
            ),
          )
          .limit(1);
        if (current?.state === "processing") return;
        throw this.stateConflict(current?.state ?? "missing");
      }
      await tx
        .insert(outboxEvents)
        .values({
          organizationId,
          topic: "privacy.request.processing",
          aggregateType: "privacy_request",
          aggregateId: `${requestId}:${request.attempts}`,
          payload: { organizationId, requestId, attempt: request.attempts },
        })
        .onConflictDoNothing();
      await tx.insert(auditEvents).values({
        organizationId,
        actorIdentityId: auth.identityId,
        action,
        entityType: "privacy_request",
        entityId: requestId,
        metadata: redactPrivacyMetadata({
          attempt: request.attempts,
          requestType: request.type,
          state: "processing",
        }),
      });
    });
  }

  private async status(
    _identityId: string,
    organizationId: string,
    requestId: string,
    db = this.database.db,
  ) {
    const [request] = await db
      .select({
        id: privacyRequests.id,
        type: privacyRequests.type,
        state: privacyRequests.state,
        attempts: privacyRequests.attempts,
        lastErrorCode: privacyRequests.lastErrorCode,
        verifiedAt: privacyRequests.verifiedAt,
        approvedAt: privacyRequests.approvedAt,
        completedAt: privacyRequests.completedAt,
        createdAt: privacyRequests.createdAt,
        updatedAt: privacyRequests.updatedAt,
      })
      .from(privacyRequests)
      .where(
        and(eq(privacyRequests.organizationId, organizationId), eq(privacyRequests.id, requestId)),
      )
      .limit(1);
    if (!request) throw this.notFound();
    const steps = await db
      .select({
        domain: privacyRequestSteps.domain,
        mandatory: privacyRequestSteps.mandatory,
        status: privacyRequestSteps.status,
        reasonCode: privacyRequestSteps.reasonCode,
        attempts: privacyRequestSteps.attempts,
      })
      .from(privacyRequestSteps)
      .where(
        and(
          eq(privacyRequestSteps.organizationId, organizationId),
          eq(privacyRequestSteps.requestId, requestId),
        ),
      );
    return { ...request, steps };
  }

  private notFound() {
    return new NotFoundException({
      code: "PRIVACY_REQUEST_NOT_FOUND",
      message: "Solicitação não encontrada.",
    });
  }

  private stateConflict(state: string) {
    return new ConflictException({
      code: "PRIVACY_STATE_CONFLICT",
      message: `A solicitação não aceita esta transição (${state}).`,
    });
  }
}
