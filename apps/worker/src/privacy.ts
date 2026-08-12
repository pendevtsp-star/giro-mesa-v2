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
  PRIVACY_REQUIRED_DOMAINS,
  type PrivacyDomain,
  privacyCompletionState,
  redactPrivacyMetadata,
} from "@giromesa/domain";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  type PrivacyRequestType,
  privacyProcessingAggregateId,
  privacyProcessorPolicy,
  REGISTERED_PRIVACY_PROCESSORS,
} from "./privacy-processors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPORT_TTL_MS = 15 * 60_000;

export interface PrivacyProcessingEvent {
  topic: string;
  aggregate_type: string;
  aggregate_id: string;
  organization_id: string | null;
  unit_id: string | null;
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
  if (
    event.topic !== "privacy.request.processing" ||
    event.aggregate_type !== "privacy_request" ||
    event.aggregate_id !== privacyProcessingAggregateId(requestId, attempt) ||
    event.organization_id !== organizationId ||
    event.unit_id !== null
  ) {
    throw new Error("PRIVACY_EVENT_CONTEXT_INVALID");
  }
  return { organizationId, requestId, attempt };
}

function privacyExportKey() {
  return encryptionKey(process.env.PRIVACY_EXPORT_ENCRYPTION_KEY, "PRIVACY_EXPORT_ENCRYPTION_KEY");
}

async function exportDomain(
  db: Database,
  input: { organizationId: string; requestId: string; attempt: number },
  domain: Exclude<PrivacyDomain, "identity" | "organization_membership">,
) {
  const rows = (await db.execute(sql`
    select public.giromesa_privacy_export_domain(
      ${input.organizationId}::uuid,
      ${input.requestId}::uuid,
      ${input.attempt}::integer,
      ${domain}::varchar
    ) as domain_data
  `)) as unknown as Array<{ domain_data: unknown }>;
  if (!rows[0]?.domain_data) throw new Error(`PRIVACY_DOMAIN_EXPORT_EMPTY:${domain}`);
  return rows[0].domain_data;
}

async function recordDomainAudit(
  db: Database,
  input: { organizationId: string; requestId: string; attempt: number },
  domain: PrivacyDomain,
  status: "completed" | "blocked",
  reasonCode?: string,
) {
  await db.insert(auditEvents).values({
    organizationId: input.organizationId,
    action: `privacy.domain_${status}`,
    entityType: "privacy_request",
    entityId: input.requestId,
    metadata: redactPrivacyMetadata({
      attempt: input.attempt,
      domain,
      reasonCode,
      state: status,
    }),
  });
}

export async function processPrivacyRequest(db: Database, event: PrivacyProcessingEvent) {
  const input = processingInput(event);
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`privacy-request:${input.organizationId}:${input.requestId}`}, 0))`,
  );
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
  const unknownDomains = existingSteps
    .filter(
      (step) => step.mandatory && !REGISTERED_PRIVACY_PROCESSORS.has(step.domain as PrivacyDomain),
    )
    .map((step) => step.domain);
  if (unknownDomains.length > 0) throw new Error("PRIVACY_PROCESSOR_REGISTRY_INCOMPLETE");

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

  if (request.type === "access_export") {
    const domainData: Record<string, unknown> = {};
    for (const domain of PRIVACY_REQUIRED_DOMAINS) {
      if (domain === "identity" || domain === "organization_membership") continue;
      domainData[domain] = await exportDomain(db, input, domain);
    }
    const payload = JSON.stringify({
      schemaVersion: 1,
      requestId: request.id,
      generatedAt: new Date().toISOString(),
      partial: false,
      blockedDomains: [],
      data: { identity, organizationMemberships: membershipRows, ...domainData },
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
          inArray(privacyRequestSteps.domain, [...PRIVACY_REQUIRED_DOMAINS]),
        ),
      );
    for (const domain of PRIVACY_REQUIRED_DOMAINS) {
      await recordDomainAudit(db, input, domain, "completed");
    }
  } else {
    // Every local adapter performs a read-only preflight first. Mutations are
    // atomic across domains and therefore remain unapplied while backup/restore
    // retention lacks an approved propagation policy.
    for (const domain of PRIVACY_REQUIRED_DOMAINS) {
      const policy = privacyProcessorPolicy(request.type as PrivacyRequestType, domain);
      if (
        policy.outcome === "preflight" &&
        domain !== "identity" &&
        domain !== "organization_membership"
      ) {
        await exportDomain(db, input, domain);
      }
    }
    for (const domain of PRIVACY_REQUIRED_DOMAINS) {
      const policy = privacyProcessorPolicy(request.type as PrivacyRequestType, domain);
      const reasonCode = policy.outcome === "blocked" ? policy.reasonCode : "DEPENDENCY_BLOCKED";
      await db
        .update(privacyRequestSteps)
        .set({
          status: "blocked",
          reasonCode,
          attempts: sql`${privacyRequestSteps.attempts} + 1`,
          completedAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(privacyRequestSteps.organizationId, input.organizationId),
            eq(privacyRequestSteps.requestId, input.requestId),
            eq(privacyRequestSteps.domain, domain),
          ),
        );
      await recordDomainAudit(db, input, domain, "blocked", reasonCode);
    }
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
