import {
  auditEvents,
  type Database,
  identities,
  memberships,
  privacyExports,
  privacyRequestSteps,
  privacyRequests,
  roleBindings,
} from "@giromesa/db";
import {
  encryptionKey,
  encryptSecret,
  privacyCompletionState,
  redactPrivacyMetadata,
} from "@giromesa/domain";
import { and, eq, inArray, sql } from "drizzle-orm";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_DOMAINS = ["identity", "organization_membership"] as const;
const EXPORT_TTL_MS = 15 * 60_000;

export interface PrivacyProcessingEvent {
  payload: Record<string, unknown>;
}

function processingInput(event: PrivacyProcessingEvent) {
  const organizationId = event.payload.organizationId;
  const requestId = event.payload.requestId;
  const attempt = event.payload.attempt;
  if (
    typeof organizationId !== "string" ||
    !UUID.test(organizationId) ||
    typeof requestId !== "string" ||
    !UUID.test(requestId) ||
    typeof attempt !== "number" ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1
  ) {
    throw new Error("PRIVACY_EVENT_INVALID");
  }
  return { organizationId, requestId, attempt };
}

function privacyExportKey() {
  return encryptionKey(process.env.PRIVACY_EXPORT_ENCRYPTION_KEY, "PRIVACY_EXPORT_ENCRYPTION_KEY");
}

export async function processPrivacyRequest(db: Database, event: PrivacyProcessingEvent) {
  const input = processingInput(event);
  const [request] = await db
    .select()
    .from(privacyRequests)
    .where(
      and(
        eq(privacyRequests.organizationId, input.organizationId),
        eq(privacyRequests.id, input.requestId),
      ),
    )
    .limit(1);
  if (request?.state !== "processing" || request.attempts !== input.attempt) {
    return { replayed: true as const };
  }

  const existingSteps = await db
    .select()
    .from(privacyRequestSteps)
    .where(
      and(
        eq(privacyRequestSteps.organizationId, input.organizationId),
        eq(privacyRequestSteps.requestId, input.requestId),
      ),
    );
  const missingDomains = existingSteps
    .filter((step) => step.mandatory && step.reasonCode === "PROCESSOR_ABSENT")
    .map((step) => step.domain);

  if (request.type === "access_export") {
    const [identity] = await db
      .select({
        id: identities.id,
        email: identities.email,
        displayName: identities.displayName,
        emailVerifiedAt: identities.emailVerifiedAt,
        createdAt: identities.createdAt,
        updatedAt: identities.updatedAt,
      })
      .from(identities)
      .where(eq(identities.id, request.subjectIdentityId))
      .limit(1);
    if (!identity) throw new Error("PRIVACY_SUBJECT_NOT_FOUND");
    const membershipRows = await db
      .select({
        membershipId: memberships.id,
        organizationId: memberships.organizationId,
        status: memberships.status,
        role: roleBindings.role,
        unitId: roleBindings.unitId,
      })
      .from(memberships)
      .leftJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
      .where(
        and(
          eq(memberships.identityId, request.subjectIdentityId),
          eq(memberships.organizationId, input.organizationId),
        ),
      );
    const payload = JSON.stringify({
      schemaVersion: 1,
      requestId: request.id,
      generatedAt: new Date().toISOString(),
      partial: missingDomains.length > 0,
      blockedDomains: missingDomains,
      data: { identity, organizationMemberships: membershipRows },
    });
    const envelope = encryptSecret(
      payload,
      privacyExportKey(),
      `privacy-export:${input.organizationId}:${input.requestId}:${request.subjectIdentityId}`,
    );
    await db
      .insert(privacyExports)
      .values({
        organizationId: input.organizationId,
        requestId: input.requestId,
        subjectIdentityId: request.subjectIdentityId,
        encryptedPayload: envelope.encryptedSecret,
        iv: envelope.iv,
        authTag: envelope.authTag,
        expiresAt: new Date(Date.now() + EXPORT_TTL_MS),
      })
      .onConflictDoUpdate({
        target: [privacyExports.organizationId, privacyExports.requestId],
        set: {
          encryptedPayload: envelope.encryptedSecret,
          iv: envelope.iv,
          authTag: envelope.authTag,
          expiresAt: new Date(Date.now() + EXPORT_TTL_MS),
          downloadedAt: null,
        },
      });
    await db
      .update(privacyRequestSteps)
      .set({
        status: "completed",
        reasonCode: null,
        attempts: sql`${privacyRequestSteps.attempts} + 1`,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(privacyRequestSteps.organizationId, input.organizationId),
          eq(privacyRequestSteps.requestId, input.requestId),
          inArray(privacyRequestSteps.domain, [...LOCAL_DOMAINS]),
        ),
      );
  } else {
    // Mutating processors are deliberately preflight-only until every mandatory
    // propagation adapter exists. This prevents an irreversible partial erasure.
    await db
      .update(privacyRequestSteps)
      .set({
        status: "blocked",
        reasonCode: "DEPENDENCY_BLOCKED",
        attempts: sql`${privacyRequestSteps.attempts} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(privacyRequestSteps.organizationId, input.organizationId),
          eq(privacyRequestSteps.requestId, input.requestId),
          inArray(privacyRequestSteps.domain, [...LOCAL_DOMAINS]),
        ),
      );
  }

  const finalSteps = await db
    .select({ mandatory: privacyRequestSteps.mandatory, status: privacyRequestSteps.status })
    .from(privacyRequestSteps)
    .where(
      and(
        eq(privacyRequestSteps.organizationId, input.organizationId),
        eq(privacyRequestSteps.requestId, input.requestId),
      ),
    );
  const finalState = privacyCompletionState(finalSteps);
  await db
    .update(privacyRequests)
    .set({
      state: finalState,
      completedAt: finalState === "completed" ? new Date() : null,
      lastErrorCode: finalState === "partial" ? "MANDATORY_PROCESSORS_BLOCKED" : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(privacyRequests.organizationId, input.organizationId),
        eq(privacyRequests.id, input.requestId),
        eq(privacyRequests.state, "processing"),
        eq(privacyRequests.attempts, input.attempt),
      ),
    );
  await db.insert(auditEvents).values({
    organizationId: input.organizationId,
    action: `privacy.processing_${finalState}`,
    entityType: "privacy_request",
    entityId: input.requestId,
    metadata: redactPrivacyMetadata({ attempt: input.attempt, state: finalState }),
  });
  return { replayed: false as const, state: finalState };
}

export async function failPrivacyRequest(db: Database, event: PrivacyProcessingEvent) {
  let input: ReturnType<typeof processingInput>;
  try {
    input = processingInput(event);
  } catch {
    return false;
  }
  const [failed] = await db
    .update(privacyRequests)
    .set({ state: "failed", lastErrorCode: "PRIVACY_PROCESSING_FAILED", updatedAt: new Date() })
    .where(
      and(
        eq(privacyRequests.organizationId, input.organizationId),
        eq(privacyRequests.id, input.requestId),
        eq(privacyRequests.state, "processing"),
        eq(privacyRequests.attempts, input.attempt),
      ),
    )
    .returning({ id: privacyRequests.id });
  if (!failed) return false;
  await db.insert(auditEvents).values({
    organizationId: input.organizationId,
    action: "privacy.processing_failed",
    entityType: "privacy_request",
    entityId: input.requestId,
    metadata: redactPrivacyMetadata({ attempt: input.attempt, state: "failed" }),
  });
  return true;
}
