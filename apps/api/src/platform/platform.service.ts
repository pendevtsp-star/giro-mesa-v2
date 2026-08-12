import { createHash, randomUUID } from "node:crypto";
import {
  auditEvents,
  commercialPlans,
  contactRequests,
  growthIntegrations,
  identities,
  managementIncidents,
  memberships,
  onboardingChecklistItems,
  onboardingRecords,
  organizations,
  provisioningRuns,
  roleBindings,
  subscriptionEntitlements,
  subscriptions,
  type TenantTransaction,
  trialApplications,
  units,
} from "@giromesa/db";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { and, asc, desc, eq, lt, or, sql } from "drizzle-orm";
import type { AuthContext } from "../auth/auth.service.js";
import { DatabaseService } from "../database/database.module.js";
import {
  canPlatformMutate,
  hasRecentPlatformStepUp,
  type PlatformAccess,
  type PlatformActionCommand,
  type PlatformActionName,
  platformAccessFor,
} from "./platform-access.js";
import {
  actionRequestFingerprint,
  assertPlatformActionTransition,
  decisionRequestFingerprint,
  type PlatformActionInput,
  type PlatformActionSnapshot,
  parsePlatformActionInput,
  platformActionFromAuditEvents,
  platformActionTargetType,
} from "./platform-actions.js";
import { PlatformDurableOutcomeError } from "./platform-errors.js";
import {
  finalizePlatformKeysetPage,
  maskPlatformEmail,
  type PlatformProjectionPage,
  type PlatformResource,
  paginatePlatformItems,
  parsePlatformKeysetPage,
  sanitizePlatformAuditItem,
  sanitizePlatformIncident,
  sanitizePlatformIntegration,
  sanitizePlatformLead,
  sanitizePlatformSupportRequest,
  unavailablePlatformProjection,
} from "./platform-projections.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const idempotencyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/;
const platformResources = new Set<PlatformResource>([
  "leads",
  "tenant",
  "plan",
  "entitlements",
  "users",
  "onboarding",
  "billing",
  "support",
  "integrations",
  "incidents",
  "audit",
]);
const globalPlatformResources = new Set<PlatformResource>(["leads", "support"]);

function isIncidentAction(action: PlatformActionName) {
  return (
    action === "incident.review" ||
    action === "incident.approve" ||
    action === "incident.reject" ||
    action === "incident.close"
  );
}

type ActionEvent = {
  action: string;
  actorIdentityId: string | null;
  occurredAt: Date;
  metadata: Record<string, unknown>;
};

@Injectable()
export class PlatformService {
  constructor(private readonly database: DatabaseService) {}

  async overview(auth: AuthContext) {
    const access = this.assertRead(auth);
    const [counts, stepUp] = await Promise.all([
      this.database.db.execute(
        sql<{
          organizations: number;
          active: number;
          attention: number;
        }>`select * from public.giromesa_platform_overview()`,
      ),
      this.recentStepUp(auth),
    ]);
    const [overview] = [...counts];
    return {
      counts: overview ?? { organizations: 0, active: 0, attention: 0 },
      access: {
        permissions: access.permissions,
        stepUp: hasRecentPlatformStepUp(stepUp),
        stepUpExpiresAt: stepUp ? new Date(stepUp.getTime() + 10 * 60 * 1000).toISOString() : null,
      },
    };
  }

  async context(auth: AuthContext, organizationId: string, unitId?: string) {
    this.assertRead(auth);
    this.assertUuid(organizationId, "organizationId");
    if (unitId) this.assertUuid(unitId, "unitId");
    const context = await this.requireTenantContext(this.database.db, organizationId, unitId);
    return context;
  }

  async projection(
    auth: AuthContext,
    organizationId: string,
    resourceInput: string,
    options: { unitId?: string; limit?: number; cursor?: string },
  ): Promise<PlatformProjectionPage> {
    const access = this.assertRead(auth);
    this.assertUuid(organizationId, "organizationId");
    if (!platformResources.has(resourceInput as PlatformResource))
      throw new BadRequestException("INVALID_PLATFORM_RESOURCE");
    const resource = resourceInput as PlatformResource;
    const limit = options.limit ?? 25;
    await this.requireTenantContext(this.database.db, organizationId, options.unitId);

    if (resource === "leads" || resource === "support")
      return unavailablePlatformProjection(resource, "PLATFORM_RESOURCE_GLOBAL_ONLY");

    if (resource === "incidents") {
      const pageRequest = parsePlatformKeysetPage(limit, options.cursor);
      const scope = options.unitId
        ? and(
            eq(managementIncidents.organizationId, organizationId),
            eq(managementIncidents.unitId, options.unitId),
          )
        : eq(managementIncidents.organizationId, organizationId);
      const rows = await this.database.db
        .select({
          id: managementIncidents.id,
          organizationId: managementIncidents.organizationId,
          unitId: managementIncidents.unitId,
          incidentType: managementIncidents.incidentType,
          status: managementIncidents.status,
          neutralSummary: managementIncidents.neutralSummary,
          amountCents: managementIncidents.amountCents,
          reporterIdentityId: managementIncidents.reporterIdentityId,
          approverIdentityId: managementIncidents.approverIdentityId,
          occurredAt: managementIncidents.occurredAt,
          updatedAt: managementIncidents.updatedAt,
        })
        .from(managementIncidents)
        .where(
          pageRequest.cursor
            ? and(
                scope,
                or(
                  lt(managementIncidents.occurredAt, pageRequest.cursor.createdAt),
                  and(
                    eq(managementIncidents.occurredAt, pageRequest.cursor.createdAt),
                    lt(managementIncidents.id, pageRequest.cursor.id),
                  ),
                ),
              )
            : scope,
        )
        .orderBy(desc(managementIncidents.occurredAt), desc(managementIncidents.id))
        .limit(pageRequest.limit + 1);
      const page = finalizePlatformKeysetPage(
        rows,
        pageRequest.limit,
        sanitizePlatformIncident,
        (row) => row.occurredAt,
      );
      return { resource, availability: "available", ...page };
    }

    const items = await this.projectAvailableResource(
      organizationId,
      options.unitId,
      resource as Exclude<PlatformResource, "leads" | "support" | "incidents">,
      access,
    );
    const page = paginatePlatformItems(items, limit, options.cursor);
    return { resource, availability: "available", ...page };
  }

  async globalProjection(
    auth: AuthContext,
    resourceInput: string,
    options: { limit?: number; cursor?: string },
  ): Promise<PlatformProjectionPage> {
    const access = this.assertRead(auth);
    if (!globalPlatformResources.has(resourceInput as PlatformResource))
      throw new BadRequestException("INVALID_GLOBAL_PLATFORM_RESOURCE");
    const resource = resourceInput as "leads" | "support";
    const canReadPii = access.permissions.includes("platform.pii.read");
    const pageRequest = parsePlatformKeysetPage(options.limit ?? 25, options.cursor);
    if (resource === "leads") {
      const rows = await this.database.db
        .select({
          id: trialApplications.id,
          name: trialApplications.name,
          email: trialApplications.email,
          phone: trialApplications.phone,
          businessName: trialApplications.businessName,
          segment: trialApplications.segment,
          planSlug: trialApplications.planSlug,
          consentedAt: trialApplications.consentedAt,
          createdAt: trialApplications.createdAt,
        })
        .from(trialApplications)
        .where(
          pageRequest.cursor
            ? or(
                lt(trialApplications.createdAt, pageRequest.cursor.createdAt),
                and(
                  eq(trialApplications.createdAt, pageRequest.cursor.createdAt),
                  lt(trialApplications.id, pageRequest.cursor.id),
                ),
              )
            : undefined,
        )
        .orderBy(desc(trialApplications.createdAt), desc(trialApplications.id))
        .limit(pageRequest.limit + 1);
      const page = finalizePlatformKeysetPage(
        rows,
        pageRequest.limit,
        (row) => sanitizePlatformLead(row, canReadPii),
        (row) => row.createdAt,
      );
      return { resource, availability: "available", ...page };
    }
    const rows = await this.database.db
      .select({
        id: contactRequests.id,
        name: contactRequests.name,
        email: contactRequests.email,
        phone: contactRequests.phone,
        consentedAt: contactRequests.consentedAt,
        createdAt: contactRequests.createdAt,
      })
      .from(contactRequests)
      .where(
        pageRequest.cursor
          ? or(
              lt(contactRequests.createdAt, pageRequest.cursor.createdAt),
              and(
                eq(contactRequests.createdAt, pageRequest.cursor.createdAt),
                lt(contactRequests.id, pageRequest.cursor.id),
              ),
            )
          : undefined,
      )
      .orderBy(desc(contactRequests.createdAt), desc(contactRequests.id))
      .limit(pageRequest.limit + 1);
    const page = finalizePlatformKeysetPage(
      rows,
      pageRequest.limit,
      (row) => sanitizePlatformSupportRequest(row, canReadPii),
      (row) => row.createdAt,
    );
    return { resource, availability: "available", ...page };
  }

  async actions(
    auth: AuthContext,
    organizationId: string,
    options: { limit?: number; cursor?: string } = {},
  ) {
    this.assertRead(auth);
    this.assertUuid(organizationId, "organizationId");
    await this.requireTenantContext(this.database.db, organizationId);
    const rows = await this.database.db
      .select({
        entityId: auditEvents.entityId,
        action: auditEvents.action,
        actorIdentityId: auditEvents.actorIdentityId,
        occurredAt: auditEvents.occurredAt,
        metadata: auditEvents.metadata,
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, organizationId),
          eq(auditEvents.entityType, "platform_action"),
        ),
      )
      .orderBy(sql`(${auditEvents.metadata}->>'version')::int`, asc(auditEvents.id));
    const grouped = new Map<string, ActionEvent[]>();
    for (const row of rows) {
      if (!row.entityId) continue;
      const events = grouped.get(row.entityId) ?? [];
      events.push(row);
      grouped.set(row.entityId, events);
    }
    const now = Date.now();
    const snapshots = [...grouped.entries()]
      .map(([id, events]) => platformActionFromAuditEvents(organizationId, id, events))
      .map((snapshot) =>
        snapshot.status === "pending" && new Date(snapshot.expiresAt).getTime() <= now
          ? { ...snapshot, status: "expired" as const }
          : snapshot,
      )
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt));
    return paginatePlatformItems(snapshots, options.limit ?? 25, options.cursor);
  }

  async propose(
    auth: AuthContext,
    organizationId: string,
    idempotencyKey: string | undefined,
    rawInput: unknown,
  ) {
    this.assertUuid(organizationId, "organizationId");
    const input = parsePlatformActionInput(rawInput);
    await this.assertMutation(auth, input.action, "propose");
    const keyHash = this.idempotencyHash(idempotencyKey);
    const fingerprint = actionRequestFingerprint(organizationId, input);
    if (input.action.startsWith("tenant.") && input.targetId !== organizationId)
      throw new BadRequestException("PLATFORM_TARGET_SCOPE_MISMATCH");

    return this.database.db.transaction(async (tx) => {
      await this.lock(tx, `platform:proposal:${organizationId}:${keyHash}`);
      const existing = await this.findProposalByIdempotency(tx, organizationId, keyHash);
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new ConflictException("PLATFORM_IDEMPOTENCY_CONFLICT");
        return this.loadAction(tx, organizationId, existing.id);
      }
      await this.validateActionPrecondition(tx, organizationId, auth.identityId, input);
      const id = randomUUID();
      const requestedAt = new Date();
      const expiresAt = new Date(requestedAt.getTime() + 15 * 60 * 1000);
      await tx.insert(auditEvents).values({
        organizationId,
        actorIdentityId: auth.identityId,
        action: "platform.action.proposed",
        entityType: "platform_action",
        entityId: id,
        occurredAt: requestedAt,
        metadata: {
          version: 1,
          status: "pending",
          action: input.action,
          targetType: platformActionTargetType(input.action),
          targetId: input.targetId,
          justification: input.justification,
          payload: input.payload,
          expiresAt: expiresAt.toISOString(),
          idempotencyHash: keyHash,
          requestFingerprint: fingerprint,
        },
      });
      return this.loadAction(tx, organizationId, id);
    });
  }

  async approve(
    auth: AuthContext,
    organizationId: string,
    proposalId: string,
    idempotencyKey: string | undefined,
    expectedVersion: number,
  ) {
    return this.decide(
      auth,
      organizationId,
      proposalId,
      idempotencyKey,
      expectedVersion,
      "approve",
    );
  }

  async reject(
    auth: AuthContext,
    organizationId: string,
    proposalId: string,
    idempotencyKey: string | undefined,
    expectedVersion: number,
  ) {
    return this.decide(auth, organizationId, proposalId, idempotencyKey, expectedVersion, "reject");
  }

  private async decide(
    auth: AuthContext,
    organizationId: string,
    proposalId: string,
    idempotencyKey: string | undefined,
    expectedVersion: number,
    command: "approve" | "reject",
  ) {
    this.assertUuid(organizationId, "organizationId");
    this.assertUuid(proposalId, "proposalId");
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1)
      throw new BadRequestException("INVALID_PLATFORM_ACTION_VERSION");
    const keyHash = this.idempotencyHash(idempotencyKey);
    const decisionFingerprint = decisionRequestFingerprint({
      organizationId,
      proposalId,
      command,
      expectedVersion,
    });
    const initial = await this.loadAction(this.database.db, organizationId, proposalId);
    await this.assertMutation(auth, initial.action, command);
    try {
      return await this.database.db.transaction(async (tx) => {
        await this.lock(tx, `platform:action:${organizationId}:${proposalId}`);
        const current = await this.loadAction(tx, organizationId, proposalId);
        const replay = await this.isDecisionReplay(
          tx,
          organizationId,
          proposalId,
          auth.identityId,
          keyHash,
        );
        if (replay) {
          if (replay.fingerprint !== decisionFingerprint)
            throw new ConflictException("PLATFORM_IDEMPOTENCY_CONFLICT");
          if (
            current.status === "executed" ||
            current.status === "rejected" ||
            current.status === "failed"
          )
            return current;
        }
        assertPlatformActionTransition(current, {
          command,
          actorIdentityId: auth.identityId,
          expectedVersion,
          now: new Date(),
        });
        if (command === "reject") {
          await tx.insert(auditEvents).values({
            organizationId,
            actorIdentityId: auth.identityId,
            action: "platform.action.rejected",
            entityType: "platform_action",
            entityId: proposalId,
            metadata: {
              version: current.version + 1,
              status: "rejected",
              decisionIdempotencyHash: keyHash,
              decisionFingerprint,
            },
          });
          return this.loadAction(tx, organizationId, proposalId);
        }
        await tx.insert(auditEvents).values({
          organizationId,
          actorIdentityId: auth.identityId,
          action: "platform.action.approved",
          entityType: "platform_action",
          entityId: proposalId,
          metadata: {
            version: current.version + 1,
            status: "approved",
            decisionIdempotencyHash: keyHash,
            decisionFingerprint,
          },
        });
        const effect = await this.executeAction(tx, auth.identityId, current);
        await tx.insert(auditEvents).values({
          organizationId,
          actorIdentityId: auth.identityId,
          action: "platform.action.executed",
          entityType: "platform_action",
          entityId: proposalId,
          metadata: {
            version: current.version + 2,
            status: "executed",
            decisionIdempotencyHash: keyHash,
            decisionFingerprint,
            before: effect.before,
            after: effect.after,
          },
        });
        return this.loadAction(tx, organizationId, proposalId);
      });
    } catch (error) {
      if (this.isPolicyFailure(error)) throw error;
      await this.recordFailedExecution(
        auth,
        organizationId,
        proposalId,
        keyHash,
        decisionFingerprint,
        error,
      );
      throw new PlatformDurableOutcomeError(error);
    }
  }

  private assertRead(auth: AuthContext): PlatformAccess {
    const access = platformAccessFor(auth.email);
    if (!access.permissions.includes("platform.read")) throw new ForbiddenException();
    return access;
  }

  private async assertMutation(
    auth: AuthContext,
    action: PlatformActionName,
    command: PlatformActionCommand,
  ) {
    const access = this.assertRead(auth);
    if (!canPlatformMutate(access, action, command))
      throw new ForbiddenException("PLATFORM_PERMISSION_REQUIRED");
    const stepUp = await this.recentStepUp(auth);
    if (!hasRecentPlatformStepUp(stepUp))
      throw new UnauthorizedException("PLATFORM_STEP_UP_REQUIRED");
  }

  private recentStepUp(auth: AuthContext) {
    return this.database.db
      .select({ occurredAt: auditEvents.occurredAt })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.actorIdentityId, auth.identityId),
          eq(auditEvents.action, "auth.mfa_verified"),
          eq(auditEvents.entityType, "session"),
          eq(auditEvents.entityId, auth.sessionId),
        ),
      )
      .orderBy(desc(auditEvents.occurredAt))
      .limit(1)
      .then((rows) => rows[0]?.occurredAt ?? null);
  }

  private async requireTenantContext(
    db: TenantTransaction | DatabaseService["db"],
    organizationId: string,
    unitId?: string,
  ) {
    const [organization] = await db
      .select({
        organizationId: organizations.id,
        name: organizations.tradeName,
        billingState: organizations.billingState,
        updatedAt: organizations.updatedAt,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!organization) throw new NotFoundException("PLATFORM_TENANT_NOT_FOUND");
    const unitRows = await db
      .select({ id: units.id, name: units.name, active: units.active, timezone: units.timezone })
      .from(units)
      .where(
        unitId
          ? and(eq(units.organizationId, organizationId), eq(units.id, unitId))
          : eq(units.organizationId, organizationId),
      )
      .orderBy(asc(units.name));
    if (unitId && unitRows.length === 0) throw new NotFoundException("PLATFORM_UNIT_NOT_FOUND");
    return {
      organization: {
        id: organization.organizationId,
        name: organization.name,
        billingState: organization.billingState,
        updatedAt: organization.updatedAt.toISOString(),
      },
      units: unitRows,
      selectedUnitId: unitId ?? null,
    };
  }

  private async projectAvailableResource(
    organizationId: string,
    unitId: string | undefined,
    resource: Exclude<PlatformResource, "leads" | "support" | "incidents">,
    access: PlatformAccess,
  ): Promise<Record<string, unknown>[]> {
    if (resource === "tenant") {
      const context = await this.requireTenantContext(this.database.db, organizationId, unitId);
      return [
        {
          organizationId,
          name: context.organization.name,
          billingState: context.organization.billingState,
          updatedAt: context.organization.updatedAt,
          units: context.units,
        },
      ];
    }
    if (resource === "plan") {
      return this.database.db
        .select({
          organizationId: onboardingRecords.organizationId,
          planId: commercialPlans.id,
          slug: commercialPlans.slug,
          name: commercialPlans.name,
          selectionRevision: onboardingRecords.selectionRevision,
          selectedAt: onboardingRecords.selectedAt,
        })
        .from(onboardingRecords)
        .innerJoin(commercialPlans, eq(commercialPlans.id, onboardingRecords.selectedPlanId))
        .where(eq(onboardingRecords.organizationId, organizationId));
    }
    if (resource === "entitlements") {
      return this.database.db
        .select({
          organizationId: subscriptionEntitlements.organizationId,
          entitlement: subscriptionEntitlements.entitlement,
          state: subscriptionEntitlements.state,
          activatedAt: subscriptionEntitlements.activatedAt,
          revokedAt: subscriptionEntitlements.revokedAt,
        })
        .from(subscriptionEntitlements)
        .where(eq(subscriptionEntitlements.organizationId, organizationId))
        .orderBy(asc(subscriptionEntitlements.entitlement));
    }
    if (resource === "users") {
      const rows = await this.database.db
        .select({
          organizationId: memberships.organizationId,
          membershipId: memberships.id,
          identityId: identities.id,
          displayName: identities.displayName,
          email: identities.email,
          status: memberships.status,
          role: roleBindings.role,
          unitId: roleBindings.unitId,
        })
        .from(memberships)
        .innerJoin(identities, eq(identities.id, memberships.identityId))
        .leftJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
        .where(eq(memberships.organizationId, organizationId))
        .orderBy(asc(identities.displayName));
      const grouped = new Map<string, Record<string, unknown>>();
      for (const row of rows) {
        const item = grouped.get(row.membershipId) ?? {
          organizationId,
          membershipId: row.membershipId,
          identityId: row.identityId,
          displayName: row.displayName,
          email: maskPlatformEmail(row.email, access.permissions.includes("platform.pii.read")),
          status: row.status,
          roles: [],
        };
        if (row.role)
          (item.roles as Array<Record<string, unknown>>).push({
            role: row.role,
            unitId: row.unitId,
          });
        grouped.set(row.membershipId, item);
      }
      return [...grouped.values()];
    }
    if (resource === "onboarding") {
      const [checklist, runs] = await Promise.all([
        this.database.db
          .select({
            organizationId: onboardingChecklistItems.organizationId,
            kind: sql<string>`'checklist'`,
            item: onboardingChecklistItems.item,
            status: onboardingChecklistItems.status,
            source: onboardingChecklistItems.source,
            verifiedAt: onboardingChecklistItems.verifiedAt,
          })
          .from(onboardingChecklistItems)
          .where(eq(onboardingChecklistItems.organizationId, organizationId)),
        this.database.db
          .select({
            organizationId: provisioningRuns.organizationId,
            kind: sql<string>`'provisioning'`,
            id: provisioningRuns.id,
            state: provisioningRuns.state,
            checkpoint: provisioningRuns.checkpoint,
            lastErrorCode: provisioningRuns.lastErrorCode,
            updatedAt: provisioningRuns.updatedAt,
          })
          .from(provisioningRuns)
          .where(eq(provisioningRuns.organizationId, organizationId)),
      ]);
      return [...checklist, ...runs];
    }
    if (resource === "billing") {
      return this.database.db
        .select({
          organizationId: subscriptions.organizationId,
          id: subscriptions.id,
          planId: subscriptions.commercialPlanId,
          cycle: subscriptions.cycle,
          state: subscriptions.state,
          currentPeriodEndsAt: subscriptions.currentPeriodEndsAt,
          updatedAt: subscriptions.updatedAt,
        })
        .from(subscriptions)
        .where(eq(subscriptions.organizationId, organizationId));
    }
    if (resource === "integrations") {
      const rows = await this.database.db
        .select({
          id: growthIntegrations.id,
          organizationId: growthIntegrations.organizationId,
          unitId: growthIntegrations.unitId,
          provider: growthIntegrations.provider,
          status: growthIntegrations.status,
          updatedAt: growthIntegrations.updatedAt,
        })
        .from(growthIntegrations)
        .where(
          unitId
            ? and(
                eq(growthIntegrations.organizationId, organizationId),
                eq(growthIntegrations.unitId, unitId),
              )
            : eq(growthIntegrations.organizationId, organizationId),
        );
      return rows.map(sanitizePlatformIntegration);
    }
    const rows = await this.database.db
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        entityType: auditEvents.entityType,
        entityId: auditEvents.entityId,
        metadata: auditEvents.metadata,
        occurredAt: auditEvents.occurredAt,
      })
      .from(auditEvents)
      .where(
        unitId
          ? and(eq(auditEvents.organizationId, organizationId), eq(auditEvents.unitId, unitId))
          : eq(auditEvents.organizationId, organizationId),
      )
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(500);
    return rows.map(sanitizePlatformAuditItem);
  }

  private async validateActionPrecondition(
    tx: TenantTransaction,
    organizationId: string,
    actorIdentityId: string,
    input: PlatformActionInput,
  ) {
    await this.requireTenantContext(tx, organizationId);
    if (input.action === "tenant.suspend" || input.action === "tenant.restore") {
      const expectedState = input.payload.expectedState;
      const [row] = await tx
        .select({ state: organizations.billingState })
        .from(organizations)
        .where(
          and(eq(organizations.id, organizationId), eq(organizations.billingState, expectedState)),
        );
      if (!row) throw new ConflictException("PLATFORM_ACTION_PRECONDITION_FAILED");
      return;
    }
    if (isIncidentAction(input.action)) {
      const incidentInput = input as Extract<
        PlatformActionInput,
        { action: "incident.review" | "incident.approve" | "incident.reject" | "incident.close" }
      >;
      await this.requireTenantContext(tx, organizationId, incidentInput.payload.unitId);
      const [incident] = await tx
        .select({
          status: managementIncidents.status,
          reporterIdentityId: managementIncidents.reporterIdentityId,
        })
        .from(managementIncidents)
        .where(
          and(
            eq(managementIncidents.organizationId, organizationId),
            eq(managementIncidents.unitId, incidentInput.payload.unitId),
            eq(managementIncidents.id, incidentInput.targetId),
            eq(managementIncidents.status, incidentInput.payload.expectedState),
          ),
        );
      if (!incident) throw new ConflictException("PLATFORM_ACTION_PRECONDITION_FAILED");
      if (
        (incidentInput.action === "incident.approve" ||
          incidentInput.action === "incident.reject") &&
        incident.reporterIdentityId === actorIdentityId
      )
        throw new ConflictException("INCIDENT_INDEPENDENT_ACTOR_REQUIRED");
      return;
    }
    const expectedState = input.payload.expectedState as "active" | "disabled";
    const [membership] = await tx
      .select({ identityId: memberships.identityId, status: memberships.status })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.id, input.targetId),
          eq(memberships.status, expectedState),
        ),
      );
    if (!membership) throw new ConflictException("PLATFORM_ACTION_PRECONDITION_FAILED");
    if (membership.identityId === actorIdentityId)
      throw new ConflictException("PLATFORM_SELF_MEMBERSHIP_ACTION_FORBIDDEN");
  }

  private async executeAction(
    tx: TenantTransaction,
    actorIdentityId: string,
    snapshot: PlatformActionSnapshot,
  ) {
    if (snapshot.action === "tenant.suspend" || snapshot.action === "tenant.restore") {
      const expected = snapshot.payload.expectedState as
        | "draft"
        | "onboarding"
        | "trial_active"
        | "active"
        | "grace"
        | "restricted"
        | "suspended";
      const next =
        snapshot.action === "tenant.suspend"
          ? ("suspended" as const)
          : (snapshot.payload.restoreTo as
              | "draft"
              | "onboarding"
              | "trial_active"
              | "active"
              | "grace"
              | "restricted");
      const [updated] = await tx
        .update(organizations)
        .set({ billingState: next, billingStateChangedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(organizations.id, snapshot.organizationId),
            eq(organizations.billingState, expected),
          ),
        )
        .returning({ state: organizations.billingState });
      if (!updated) throw new ConflictException("PLATFORM_ACTION_PRECONDITION_FAILED");
      return { before: { state: expected }, after: { state: updated.state } };
    }

    if (snapshot.action.startsWith("incident.")) {
      const expected = snapshot.payload.expectedState as
        | "reported"
        | "under_review"
        | "approved"
        | "rejected";
      const next =
        snapshot.action === "incident.review"
          ? "under_review"
          : snapshot.action === "incident.approve"
            ? "approved"
            : snapshot.action === "incident.reject"
              ? "rejected"
              : "closed";
      const requestHash = createHash("sha256")
        .update(
          JSON.stringify({
            proposalId: snapshot.id,
            organizationId: snapshot.organizationId,
            unitId: snapshot.payload.unitId,
            incidentId: snapshot.targetId,
            expected,
            next,
            justification: snapshot.justification,
          }),
        )
        .digest("hex");
      let result: Awaited<ReturnType<TenantTransaction["execute"]>>;
      try {
        result = await tx.execute(
          sql<{ status: string; approverIdentityId: string | null }>`
            select status, approver_identity_id as "approverIdentityId"
            from public.giromesa_platform_transition_incident(
              ${snapshot.organizationId}::uuid,
              ${snapshot.payload.unitId}::uuid,
              ${snapshot.targetId}::uuid,
              ${next}::text,
              ${snapshot.justification}::text,
              ${`platform-incident:${snapshot.id}`}::text,
              ${requestHash}::text,
              ${actorIdentityId}::uuid
            )
          `,
        );
      } catch (error) {
        const databaseCode =
          (error as { code?: unknown }).code ??
          (error as { cause?: { code?: unknown } }).cause?.code;
        if (databaseCode === "23505" || databaseCode === "23514" || databaseCode === "P0002")
          throw new ConflictException("PLATFORM_ACTION_PRECONDITION_FAILED");
        if (databaseCode === "42501") throw new ForbiddenException("INCIDENT_TRANSITION_FORBIDDEN");
        throw error;
      }
      const [updated] = [...result];
      if (!updated || updated.status !== next)
        throw new ConflictException("PLATFORM_ACTION_PRECONDITION_FAILED");
      return {
        before: { state: expected },
        after: { state: updated.status, approverIdentityId: updated.approverIdentityId },
      };
    }

    await this.lock(tx, `platform:organization:${snapshot.organizationId}:membership-owners`);
    const [target] = await tx
      .select({ identityId: memberships.identityId, status: memberships.status })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, snapshot.organizationId),
          eq(memberships.id, snapshot.targetId),
        ),
      );
    if (!target || target.status !== snapshot.payload.expectedState)
      throw new ConflictException("PLATFORM_ACTION_PRECONDITION_FAILED");
    if (target.identityId === actorIdentityId)
      throw new ConflictException("PLATFORM_SELF_MEMBERSHIP_ACTION_FORBIDDEN");
    if (snapshot.action === "membership.disable") {
      const [ownerBinding] = await tx
        .select({ id: roleBindings.id })
        .from(roleBindings)
        .where(
          and(eq(roleBindings.membershipId, snapshot.targetId), eq(roleBindings.role, "owner")),
        )
        .limit(1);
      if (ownerBinding) {
        const [owners] = await tx
          .select({ count: sql<number>`count(distinct ${memberships.id})::int` })
          .from(memberships)
          .innerJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
          .where(
            and(
              eq(memberships.organizationId, snapshot.organizationId),
              eq(memberships.status, "active"),
              eq(roleBindings.role, "owner"),
            ),
          );
        if ((owners?.count ?? 0) <= 1) throw new ConflictException("PLATFORM_LAST_OWNER_PROTECTED");
      }
    }
    const next =
      snapshot.action === "membership.disable" ? ("disabled" as const) : ("active" as const);
    const [updated] = await tx
      .update(memberships)
      .set({ status: next, updatedAt: new Date() })
      .where(
        and(
          eq(memberships.organizationId, snapshot.organizationId),
          eq(memberships.id, snapshot.targetId),
          eq(memberships.status, target.status),
        ),
      )
      .returning({ status: memberships.status });
    if (!updated) throw new ConflictException("PLATFORM_ACTION_PRECONDITION_FAILED");
    return { before: { state: target.status }, after: { state: updated.status } };
  }

  private async loadAction(
    db: TenantTransaction | DatabaseService["db"],
    organizationId: string,
    proposalId: string,
  ) {
    const events = await db
      .select({
        action: auditEvents.action,
        actorIdentityId: auditEvents.actorIdentityId,
        occurredAt: auditEvents.occurredAt,
        metadata: auditEvents.metadata,
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, organizationId),
          eq(auditEvents.entityType, "platform_action"),
          eq(auditEvents.entityId, proposalId),
        ),
      )
      .orderBy(sql`(${auditEvents.metadata}->>'version')::int`, asc(auditEvents.id));
    if (events.length === 0) throw new NotFoundException("PLATFORM_ACTION_NOT_FOUND");
    try {
      return platformActionFromAuditEvents(organizationId, proposalId, events);
    } catch {
      throw new ServiceUnavailableException("PLATFORM_ACTION_LEDGER_CORRUPT");
    }
  }

  private async findProposalByIdempotency(
    tx: TenantTransaction,
    organizationId: string,
    keyHash: string,
  ) {
    const [row] = await tx
      .select({
        id: auditEvents.entityId,
        fingerprint: sql<string>`${auditEvents.metadata}->>'requestFingerprint'`,
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, organizationId),
          eq(auditEvents.action, "platform.action.proposed"),
          sql`${auditEvents.metadata}->>'idempotencyHash' = ${keyHash}`,
        ),
      )
      .limit(1);
    return row?.id ? { id: row.id, fingerprint: row.fingerprint } : null;
  }

  private async isDecisionReplay(
    tx: TenantTransaction,
    organizationId: string,
    proposalId: string,
    actorIdentityId: string,
    keyHash: string,
  ) {
    const [row] = await tx
      .select({
        id: auditEvents.id,
        fingerprint: sql<string>`${auditEvents.metadata}->>'decisionFingerprint'`,
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, organizationId),
          eq(auditEvents.entityId, proposalId),
          eq(auditEvents.actorIdentityId, actorIdentityId),
          sql`${auditEvents.metadata}->>'decisionIdempotencyHash' = ${keyHash}`,
        ),
      )
      .limit(1);
    return row?.id ? { id: row.id, fingerprint: row.fingerprint } : null;
  }

  private async recordFailedExecution(
    auth: AuthContext,
    organizationId: string,
    proposalId: string,
    keyHash: string,
    decisionFingerprint: string,
    error: unknown,
  ) {
    await this.database.db.transaction(async (tx) => {
      await this.lock(tx, `platform:action:${organizationId}:${proposalId}`);
      const current = await this.loadAction(tx, organizationId, proposalId);
      if (current.status !== "pending") return;
      await tx.insert(auditEvents).values({
        organizationId,
        actorIdentityId: auth.identityId,
        action: "platform.action.failed",
        entityType: "platform_action",
        entityId: proposalId,
        metadata: {
          version: current.version + 1,
          status: "failed",
          decisionIdempotencyHash: keyHash,
          decisionFingerprint,
          failureCode: this.failureCode(error),
        },
      });
    });
  }

  private failureCode(error: unknown) {
    if (error instanceof ConflictException) return error.message;
    return "PLATFORM_ACTION_EXECUTION_FAILED";
  }

  private isPolicyFailure(error: unknown) {
    const message = error instanceof Error ? error.message : "";
    return [
      "DUAL_CONTROL_REQUIRED",
      "PLATFORM_ACTION_VERSION_CONFLICT",
      "PLATFORM_ACTION_TERMINAL",
      "PLATFORM_ACTION_EXPIRED",
      "PLATFORM_IDEMPOTENCY_CONFLICT",
    ].includes(message);
  }

  private lock(tx: TenantTransaction, key: string) {
    return tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}::text, 0))`);
  }

  private idempotencyHash(value: string | undefined) {
    if (!value || !idempotencyPattern.test(value))
      throw new BadRequestException("INVALID_IDEMPOTENCY_KEY");
    return createHash("sha256").update(value).digest("hex");
  }

  private assertUuid(value: string, field: string) {
    if (!uuidPattern.test(value)) throw new BadRequestException(`INVALID_${field.toUpperCase()}`);
  }
}
