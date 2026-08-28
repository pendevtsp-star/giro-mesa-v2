import { createHash } from "node:crypto";
import {
  auditEvents,
  charges,
  commercialPlans,
  fiscalProfiles,
  growthIntegrations,
  hubHeartbeats,
  identities,
  legalEntities,
  memberships,
  onboardingRecords,
  organizations,
  outboxEvents,
  platformActionReceipts,
  platformIncidentStates,
  providerCustomers,
  roleBindings,
  subscriptions,
  trials,
  units,
} from "@giromesa/db";
import { includesDoseClubEntitlement, missingActivationItems } from "@giromesa/domain";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import type {
  PlatformIncidentAction,
  PlatformIncidentQuery,
  PlatformTenantRegistration,
  TenantDirectoryQuery,
} from "./platform.schemas.js";
import type { PlatformAccess } from "./platform-access.js";

type IncidentSeverity = "critical" | "high" | "medium" | "low";
type IncidentState = "open" | "claimed" | "snoozed" | "resolved";
type PlatformIncident = {
  fingerprint: string;
  source: "outbox" | "hub" | "fiscal" | "billing";
  sourceId: string;
  organizationId: string | null;
  organizationName: string | null;
  unitId: string | null;
  unitName: string | null;
  severity: IncidentSeverity;
  title: string;
  detail: Record<string, unknown>;
  occurredAt: Date;
};
export type PilotAccessGrant = {
  organizationId: string;
  trialId: string;
  startsAt: string;
  previousEndsAt: string;
  endsAt: string;
  durationMonths: number;
  extended: boolean;
  doseClubQueued: boolean;
  replayed: boolean;
};

export type PlatformTenantRegistrationResult = {
  organization: { id: string; tradeName: string; billingState: "onboarding" };
  unit: { id: string; name: string };
  owner: { identityId: string; email: string };
  replayed: boolean;
};

@Injectable()
export class PlatformControlService {
  constructor(private readonly database: DatabaseService) {}

  async tenantDirectory(query: TenantDirectoryQuery) {
    const page = query.cursor ?? query.page;
    const pattern = `%${query.search}%`;
    const searchCondition = query.search
      ? or(
          ilike(organizations.tradeName, pattern),
          ilike(organizations.legalName, pattern),
          ilike(organizations.document, pattern),
          sql`exists (
            select 1 from ${memberships}
            inner join ${identities} on ${identities.id} = ${memberships.identityId}
            where ${memberships.organizationId} = ${organizations.id}
              and ${identities.email} ilike ${pattern}
          )`,
        )
      : undefined;
    const condition = and(
      searchCondition,
      query.status ? eq(organizations.billingState, query.status) : undefined,
    );
    const [items, totals] = await Promise.all([
      this.database.db
        .select({
          id: organizations.id,
          name: organizations.tradeName,
          legalName: organizations.legalName,
          document: organizations.document,
          billingState: organizations.billingState,
          billingStateChangedAt: organizations.billingStateChangedAt,
          unitCount:
            sql<number>`(select count(*)::int from ${units} where ${units.organizationId} = ${organizations.id})`.mapWith(
              Number,
            ),
          createdAt: organizations.createdAt,
          updatedAt: organizations.updatedAt,
        })
        .from(organizations)
        .where(condition)
        .orderBy(asc(organizations.tradeName), asc(organizations.id))
        .limit(query.limit)
        .offset((page - 1) * query.limit),
      this.database.db
        .select({ total: sql<number>`count(*)::int`.mapWith(Number) })
        .from(organizations)
        .where(condition),
    ]);
    const total = totals[0]?.total ?? 0;
    return {
      items: items.map((item) => ({ ...item, document: maskDocument(item.document) })),
      page,
      limit: query.limit,
      total,
      pages: Math.ceil(total / query.limit),
      nextCursor: page * query.limit < total ? String(page + 1) : null,
    };
  }

  async tenant360(organizationId: string, access: PlatformAccess) {
    const [organization] = await this.database.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!organization) throw new NotFoundException({ code: "PLATFORM_TENANT_NOT_FOUND" });

    const canReadBilling = access.capabilities.includes("billing:read");
    const canReadFiscal = access.capabilities.includes("fiscal:read");
    const [
      unitRows,
      onboardingRows,
      trialRows,
      hubRows,
      timeline,
      billingRows,
      chargeRows,
      fiscalRows,
      doseClubRows,
      subscriptionEntitlementRows,
    ] = await Promise.all([
      this.database.db
        .select()
        .from(units)
        .where(eq(units.organizationId, organizationId))
        .orderBy(asc(units.name)),
      this.database.db
        .select()
        .from(onboardingRecords)
        .where(eq(onboardingRecords.organizationId, organizationId))
        .limit(1),
      this.database.db
        .select({ trial: trials, plan: commercialPlans })
        .from(trials)
        .innerJoin(commercialPlans, eq(commercialPlans.id, trials.commercialPlanId))
        .where(eq(trials.organizationId, organizationId))
        .limit(1),
      this.database.db
        .select({
          unitId: hubHeartbeats.unitId,
          unitName: units.name,
          hubId: hubHeartbeats.hubId,
          version: hubHeartbeats.version,
          lastSeenAt: hubHeartbeats.lastSeenAt,
        })
        .from(hubHeartbeats)
        .innerJoin(units, eq(units.id, hubHeartbeats.unitId))
        .where(eq(hubHeartbeats.organizationId, organizationId))
        .orderBy(desc(hubHeartbeats.lastSeenAt)),
      this.database.db
        .select({
          id: auditEvents.id,
          action: auditEvents.action,
          entityType: auditEvents.entityType,
          entityId: auditEvents.entityId,
          metadata: auditEvents.metadata,
          occurredAt: auditEvents.occurredAt,
          actor: identities.displayName,
          actorEmail: identities.email,
        })
        .from(auditEvents)
        .leftJoin(identities, eq(identities.id, auditEvents.actorIdentityId))
        .where(eq(auditEvents.organizationId, organizationId))
        .orderBy(desc(auditEvents.occurredAt))
        .limit(100),
      canReadBilling
        ? this.database.db
            .select({
              subscription: subscriptions,
              plan: commercialPlans,
              customer: providerCustomers,
            })
            .from(subscriptions)
            .innerJoin(commercialPlans, eq(commercialPlans.id, subscriptions.commercialPlanId))
            .leftJoin(providerCustomers, eq(providerCustomers.id, subscriptions.providerCustomerId))
            .where(eq(subscriptions.organizationId, organizationId))
            .orderBy(desc(subscriptions.createdAt))
        : Promise.resolve([]),
      canReadBilling
        ? this.database.db
            .select({ charge: charges })
            .from(charges)
            .innerJoin(subscriptions, eq(subscriptions.id, charges.subscriptionId))
            .where(eq(subscriptions.organizationId, organizationId))
            .orderBy(desc(charges.createdAt))
            .limit(50)
        : Promise.resolve([]),
      canReadFiscal
        ? this.database.db
            .select({ entity: legalEntities, profile: fiscalProfiles })
            .from(legalEntities)
            .leftJoin(fiscalProfiles, eq(fiscalProfiles.legalEntityId, legalEntities.id))
            .where(eq(legalEntities.organizationId, organizationId))
            .orderBy(asc(legalEntities.legalName))
        : Promise.resolve([]),
      this.database.db
        .select({
          id: growthIntegrations.id,
          unitId: growthIntegrations.unitId,
          unitName: units.name,
          status: growthIntegrations.status,
          credentialReference: growthIntegrations.credentialReference,
          config: growthIntegrations.config,
          updatedAt: growthIntegrations.updatedAt,
        })
        .from(growthIntegrations)
        .leftJoin(units, eq(units.id, growthIntegrations.unitId))
        .where(
          and(
            eq(growthIntegrations.organizationId, organizationId),
            eq(growthIntegrations.provider, "doseclub"),
          ),
        )
        .orderBy(asc(units.name)),
      this.database.db
        .select({ state: subscriptions.state, entitlements: commercialPlans.entitlements })
        .from(subscriptions)
        .innerJoin(commercialPlans, eq(commercialPlans.id, subscriptions.commercialPlanId))
        .where(eq(subscriptions.organizationId, organizationId))
        .orderBy(desc(subscriptions.createdAt)),
    ]);

    const onboarding = onboardingRows[0];
    const effectiveEntitlements =
      organization.billingState === "trial_active"
        ? trialRows[0]?.plan.entitlements
        : (subscriptionEntitlementRows.find(({ state }) => state === "active")?.entitlements ??
          trialRows[0]?.plan.entitlements);
    const incidents = await this.incidents({
      organizationId,
      search: "",
      state: "all",
      limit: 200,
    });
    return {
      organization: {
        ...organization,
        document: maskDocument(organization.document),
      },
      units: unitRows,
      onboarding: onboarding
        ? {
            activatedAt: onboarding.activatedAt,
            missingItems: missingActivationItems(onboarding.checklist),
            updatedAt: onboarding.updatedAt,
          }
        : null,
      trial: trialRows[0] ?? null,
      billing: canReadBilling
        ? {
            subscriptions: billingRows.map(({ subscription, plan, customer }) => ({
              ...subscription,
              providerSubscriptionId: maskReference(subscription.providerSubscriptionId),
              providerCustomerReference: maskReference(customer?.providerCustomerId),
              plan,
            })),
            charges: chargeRows.map(({ charge }) => ({
              ...charge,
              providerChargeId: maskReference(charge.providerChargeId),
              paymentUrl: charge.paymentUrl ? "available" : null,
            })),
          }
        : null,
      hubs: hubRows.map((hub) => ({
        ...hub,
        stale: hub.lastSeenAt < new Date(Date.now() - 5 * 60_000),
      })),
      fiscal: canReadFiscal
        ? fiscalRows.map(({ entity, profile }) => ({
            entity: { ...entity, document: maskDocument(entity.document) },
            profile: profile
              ? {
                  id: profile.id,
                  unitId: profile.unitId,
                  provider: profile.provider,
                  environment: profile.environment,
                  approvedAt: profile.approvedAt,
                  updatedAt: profile.updatedAt,
                }
              : null,
          }))
        : null,
      doseClub: {
        providerEnabled: process.env.DOSECLUB_PROVIDER_ENABLED === "true",
        entitled: includesDoseClubEntitlement(effectiveEntitlements),
        connections: doseClubRows.map((row) => {
          const config = isRecord(row.config) ? row.config : {};
          return {
            id: row.id,
            unitId: row.unitId,
            unitName: row.unitName,
            status: row.status,
            managed: row.credentialReference?.startsWith("managed:v1:") ?? false,
            provisioningStatus: safeIntegrationText(config.provisioningStatus),
            healthCheckedAt: safeIntegrationText(config.healthCheckedAt),
            updatedAt: row.updatedAt,
          };
        }),
      },
      incidents: incidents.items,
      timeline: timeline.map((event) => ({
        ...event,
        metadata: safeAuditMetadata(event.metadata),
        actor: maskName(event.actor),
        actorEmail: maskEmail(event.actorEmail),
      })),
    };
  }

  async registerTenant(
    actorIdentityId: string,
    idempotencyKey: string,
    input: PlatformTenantRegistration,
  ): Promise<PlatformTenantRegistrationResult> {
    const action = "platform.tenant.created";
    const targetId = tenantRegistrationFingerprint(input);
    try {
      return await this.database.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`platform:${actorIdentityId}:${idempotencyKey}`}, 0))`,
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
          if (receipt.action !== action || receipt.targetId !== targetId) {
            throw new ConflictException({ code: "PLATFORM_IDEMPOTENCY_KEY_REUSED" });
          }
          return {
            ...(receipt.result as Omit<PlatformTenantRegistrationResult, "replayed">),
            replayed: true,
          };
        }

        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`platform-tenant-document:${input.document}`}, 0))`,
        );
        const [owner] = await tx
          .select({
            id: identities.id,
            email: identities.email,
            kind: identities.kind,
            disabledAt: identities.disabledAt,
            emailVerifiedAt: identities.emailVerifiedAt,
          })
          .from(identities)
          .where(eq(identities.email, input.ownerEmail))
          .for("update")
          .limit(1);
        if (!owner) {
          throw new NotFoundException({
            code: "PLATFORM_TENANT_OWNER_NOT_FOUND",
            message: "A conta proprietária deve existir antes do cadastro do tenant.",
          });
        }
        if (owner.kind !== "human" || owner.disabledAt) {
          throw new ConflictException({
            code: "PLATFORM_TENANT_OWNER_INACTIVE",
            message: "A conta proprietária está inativa e não pode receber um tenant.",
          });
        }
        if (!owner.emailVerifiedAt) {
          throw new ConflictException({
            code: "PLATFORM_TENANT_OWNER_EMAIL_UNVERIFIED",
            message: "A conta proprietária precisa confirmar o e-mail antes de receber um tenant.",
          });
        }
        const [organization] = await tx
          .insert(organizations)
          .values({
            legalName: input.legalName,
            tradeName: input.tradeName,
            document: input.document,
            billingState: "onboarding",
          })
          .returning({
            id: organizations.id,
            tradeName: organizations.tradeName,
            billingState: organizations.billingState,
          });
        if (!organization) throw new Error("Platform tenant organization was not created");
        const [legalEntity] = await tx
          .insert(legalEntities)
          .values({
            organizationId: organization.id,
            legalName: input.legalName,
            document: input.document,
          })
          .returning({ id: legalEntities.id });
        if (!legalEntity) throw new Error("Platform tenant legal entity was not created");
        const [unit] = await tx
          .insert(units)
          .values({
            organizationId: organization.id,
            legalEntityId: legalEntity.id,
            name: input.unitName,
            timezone: input.timezone,
          })
          .returning({ id: units.id, name: units.name });
        if (!unit) throw new Error("Platform tenant unit was not created");
        const [membership] = await tx
          .insert(memberships)
          .values({ identityId: owner.id, organizationId: organization.id, status: "active" })
          .returning({ id: memberships.id });
        if (!membership) throw new Error("Platform tenant owner membership was not created");
        await tx
          .insert(roleBindings)
          .values({ membershipId: membership.id, unitId: null, role: "owner" });
        await tx.insert(onboardingRecords).values({ organizationId: organization.id });
        await tx.insert(auditEvents).values({
          organizationId: organization.id,
          unitId: unit.id,
          actorIdentityId,
          action,
          entityType: "organization",
          entityId: organization.id,
          metadata: { reason: input.reason },
        });
        await tx.insert(outboxEvents).values({
          topic: "organization.created",
          aggregateType: "organization",
          aggregateId: organization.id,
          payload: { organizationId: organization.id, unitId: unit.id },
        });
        const result = {
          organization: {
            id: organization.id,
            tradeName: organization.tradeName,
            billingState: "onboarding",
          },
          unit,
          owner: { identityId: owner.id, email: owner.email },
        } satisfies Omit<PlatformTenantRegistrationResult, "replayed">;
        await tx.insert(platformActionReceipts).values({
          actorIdentityId,
          idempotencyKey,
          action,
          targetType: "organization_provisioning",
          targetId,
          reason: input.reason,
          result,
        });
        return { ...result, replayed: false };
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        error.code === "23505" &&
        "constraint" in error &&
        error.constraint === "organizations_document_unique"
      ) {
        throw new ConflictException({
          code: "PLATFORM_TENANT_DOCUMENT_EXISTS",
          message: "Já existe um tenant com este CNPJ.",
        });
      }
      throw error;
    }
  }

  async grantPilotAccess(
    actorIdentityId: string,
    organizationId: string,
    idempotencyKey: string,
    reason: string,
  ): Promise<PilotAccessGrant> {
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`platform:${actorIdentityId}:${idempotencyKey}`}, 0))`,
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
      const action = "platform.tenant.pilot_access.grant";
      if (receipt) {
        if (receipt.action !== action || receipt.targetId !== organizationId) {
          throw new ConflictException({ code: "PLATFORM_IDEMPOTENCY_KEY_REUSED" });
        }
        return {
          ...(receipt.result as Omit<PilotAccessGrant, "replayed">),
          replayed: true,
        };
      }

      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`platform-tenant:${organizationId}`}, 0))`,
      );
      const [organization] = await tx
        .select({ id: organizations.id, billingState: organizations.billingState })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .for("update")
        .limit(1);
      if (!organization) throw new NotFoundException({ code: "PLATFORM_TENANT_NOT_FOUND" });
      if (organization.billingState !== "trial_active") {
        throw new ConflictException({ code: "PLATFORM_PILOT_ACCESS_REQUIRES_ACTIVE_TRIAL" });
      }
      const [trial] = await tx
        .select({
          id: trials.id,
          startsAt: trials.startsAt,
          endsAt: trials.endsAt,
          entitlements: commercialPlans.entitlements,
        })
        .from(trials)
        .innerJoin(commercialPlans, eq(commercialPlans.id, trials.commercialPlanId))
        .where(eq(trials.organizationId, organizationId))
        .for("update")
        .limit(1);
      if (!trial) throw new ConflictException({ code: "PLATFORM_PILOT_ACCESS_TRIAL_REQUIRED" });

      const now = new Date();
      const { endsAt, extended } = resolvePilotAccessEndsAt(trial.endsAt, now);
      const doseClubQueued = includesDoseClubEntitlement(trial.entitlements);
      if (extended) {
        await tx.update(trials).set({ endsAt }).where(eq(trials.id, trial.id));
      }
      const result = {
        organizationId,
        trialId: trial.id,
        startsAt: trial.startsAt.toISOString(),
        previousEndsAt: trial.endsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        durationMonths: PILOT_ACCESS_MONTHS,
        extended,
        doseClubQueued,
      } satisfies Omit<PilotAccessGrant, "replayed">;
      if (doseClubQueued) {
        await tx.insert(outboxEvents).values({
          topic: "doseclub.provisioning_requested",
          aggregateType: "trial",
          aggregateId: trial.id,
          payload: { organizationId, trialId: trial.id },
        });
      }
      await tx.insert(auditEvents).values({
        organizationId,
        actorIdentityId,
        action,
        entityType: "trial",
        entityId: trial.id,
        metadata: { reason, ...result },
      });
      await tx.insert(platformActionReceipts).values({
        actorIdentityId,
        idempotencyKey,
        action,
        targetType: "organization",
        targetId: organizationId,
        reason,
        result,
      });
      return { ...result, replayed: false };
    });
  }

  async revealTenantPii(actorIdentityId: string, organizationId: string, reason: string) {
    const [organization] = await this.database.db
      .select({
        id: organizations.id,
        legalName: organizations.legalName,
        tradeName: organizations.tradeName,
        document: organizations.document,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!organization) throw new NotFoundException({ code: "PLATFORM_TENANT_NOT_FOUND" });
    const [entityRows, memberRows] = await Promise.all([
      this.database.db
        .select({
          id: legalEntities.id,
          legalName: legalEntities.legalName,
          document: legalEntities.document,
        })
        .from(legalEntities)
        .where(eq(legalEntities.organizationId, organizationId)),
      this.database.db
        .select({ id: identities.id, displayName: identities.displayName, email: identities.email })
        .from(memberships)
        .innerJoin(identities, eq(identities.id, memberships.identityId))
        .where(eq(memberships.organizationId, organizationId)),
    ]);
    await this.database.db.insert(auditEvents).values({
      organizationId,
      actorIdentityId,
      action: "platform.tenant.pii_accessed",
      entityType: "organization",
      entityId: organizationId,
      metadata: { reason },
    });
    return { organization, legalEntities: entityRows, members: memberRows };
  }

  async incidents(query: PlatformIncidentQuery) {
    const now = new Date();
    const requestedState = query.status ?? query.state;
    const page = query.cursor ?? 1;
    const projected = await this.projectIncidents(now);
    const stateRows = projected.length
      ? await this.database.db
          .select()
          .from(platformIncidentStates)
          .where(
            inArray(
              platformIncidentStates.fingerprint,
              projected.map((item) => item.fingerprint),
            ),
          )
      : [];
    const stateByFingerprint = new Map(stateRows.map((row) => [row.fingerprint, row]));
    const items = projected
      .map((incident) => {
        const persisted = stateByFingerprint.get(incident.fingerprint);
        const state: IncidentState =
          persisted?.status === "snoozed" && persisted.snoozedUntil && persisted.snoozedUntil <= now
            ? "open"
            : (persisted?.status ?? "open");
        return {
          ...incident,
          state,
          claimedByIdentityId: persisted?.claimedByIdentityId ?? null,
          claimedAt: persisted?.claimedAt ?? null,
          snoozedUntil: persisted?.snoozedUntil ?? null,
          resolvedAt: persisted?.resolvedAt ?? null,
          reason: persisted?.reason ?? null,
          ageMinutes: Math.max(
            0,
            Math.floor((now.getTime() - incident.occurredAt.getTime()) / 60_000),
          ),
        };
      })
      .filter(
        (incident) => !query.organizationId || incident.organizationId === query.organizationId,
      )
      .filter((incident) => !query.severity || incident.severity === query.severity)
      .filter((incident) => !query.assignee || incident.claimedByIdentityId === query.assignee)
      .filter((incident) => {
        if (!query.search) return true;
        const searchable =
          `${incident.title} ${incident.organizationName ?? ""} ${incident.unitName ?? ""} ${JSON.stringify(incident.detail)}`.toLowerCase();
        return searchable.includes(query.search.toLowerCase());
      })
      .filter((incident) => {
        if (requestedState === "all") return true;
        if (requestedState === "active")
          return incident.state === "open" || incident.state === "claimed";
        return incident.state === requestedState;
      })
      .sort(
        (left, right) =>
          severityRank(right.severity) - severityRank(left.severity) ||
          left.occurredAt.getTime() - right.occurredAt.getTime(),
      );
    const offset = (page - 1) * query.limit;
    const total = items.length;
    const oldestAgeMinutes = items.reduce((oldest, item) => Math.max(oldest, item.ageMinutes), 0);
    const pageItems = items.slice(offset, offset + query.limit);
    return {
      items: pageItems,
      total,
      truncated: false,
      oldestAgeMinutes,
      nextCursor: offset + query.limit < total ? String(page + 1) : null,
      generatedAt: now.toISOString(),
    };
  }

  async mutateIncident(
    actorIdentityId: string,
    fingerprint: string,
    idempotencyKey: string,
    input: PlatformIncidentAction,
  ) {
    const incident = (await this.projectIncidents(new Date())).find(
      (candidate) => candidate.fingerprint === fingerprint,
    );
    if (!incident) throw new NotFoundException({ code: "PLATFORM_INCIDENT_NOT_FOUND" });
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`platform:${actorIdentityId}:${idempotencyKey}`}, 0))`,
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
      const action = `platform.incident.${input.action}`;
      if (receipt) {
        if (receipt.action !== action || receipt.targetId !== fingerprint) {
          throw new ConflictException({ code: "PLATFORM_IDEMPOTENCY_KEY_REUSED" });
        }
        return { ...receipt.result, replayed: true };
      }
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`platform-incident:${fingerprint}`}, 0))`,
      );
      const [currentState] = await tx
        .select({
          status: platformIncidentStates.status,
          claimedByIdentityId: platformIncidentStates.claimedByIdentityId,
        })
        .from(platformIncidentStates)
        .where(eq(platformIncidentStates.fingerprint, fingerprint))
        .limit(1);
      if (
        input.action === "claim" &&
        currentState?.status === "claimed" &&
        currentState.claimedByIdentityId !== actorIdentityId
      ) {
        throw new ConflictException({ code: "PLATFORM_INCIDENT_ALREADY_CLAIMED" });
      }
      const now = new Date();
      const snoozedUntil = input.snoozedUntil ? new Date(input.snoozedUntil) : null;
      const status: IncidentState =
        input.action === "claim" ? "claimed" : input.action === "snooze" ? "snoozed" : "resolved";
      await tx
        .insert(platformIncidentStates)
        .values({
          fingerprint,
          source: incident.source,
          organizationId: incident.organizationId,
          unitId: incident.unitId,
          status,
          claimedByIdentityId: input.action === "claim" ? actorIdentityId : null,
          claimedAt: input.action === "claim" ? now : null,
          snoozedUntil: input.action === "snooze" ? snoozedUntil : null,
          resolvedAt: input.action === "resolve" ? now : null,
          reason: input.reason,
          updatedByIdentityId: actorIdentityId,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: platformIncidentStates.fingerprint,
          set: {
            status,
            claimedByIdentityId: input.action === "claim" ? actorIdentityId : null,
            claimedAt: input.action === "claim" ? now : null,
            snoozedUntil: input.action === "snooze" ? snoozedUntil : null,
            resolvedAt: input.action === "resolve" ? now : null,
            reason: input.reason,
            updatedByIdentityId: actorIdentityId,
            updatedAt: now,
          },
        });
      const result = {
        fingerprint,
        state: status,
        snoozedUntil: snoozedUntil?.toISOString() ?? null,
      };
      await tx.insert(auditEvents).values({
        organizationId: incident.organizationId,
        unitId: incident.unitId,
        actorIdentityId,
        action,
        entityType: "platform_incident",
        entityId: fingerprint,
        metadata: { reason: input.reason, source: incident.source, idempotencyKey },
      });
      await tx.insert(platformActionReceipts).values({
        actorIdentityId,
        idempotencyKey,
        action,
        targetType: "platform_incident",
        targetId: fingerprint,
        reason: input.reason,
        result,
      });
      return { ...result, replayed: false };
    });
  }

  async retryOutbox(
    actorIdentityId: string,
    eventId: string,
    idempotencyKey: string,
    reason: string,
  ) {
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`platform:${actorIdentityId}:${idempotencyKey}`}, 0))`,
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
        if (receipt.action !== "platform.outbox.retry" || receipt.targetId !== eventId) {
          throw new ConflictException({ code: "PLATFORM_IDEMPOTENCY_KEY_REUSED" });
        }
        return { ...receipt.result, replayed: true };
      }
      const [event] = await tx
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.id, eventId))
        .for("update")
        .limit(1);
      if (!event) throw new NotFoundException({ code: "PLATFORM_OUTBOX_EVENT_NOT_FOUND" });
      if (event.processedAt || !event.lastError) {
        throw new ConflictException({ code: "PLATFORM_OUTBOX_EVENT_NOT_FAILED" });
      }
      const now = new Date();
      await tx
        .update(outboxEvents)
        .set({ availableAt: now, lockedAt: null, lastError: null })
        .where(and(eq(outboxEvents.id, eventId), isNull(outboxEvents.processedAt)));
      const organizationId = uuidValue(event.payload.organizationId);
      const result = { eventId, queuedAt: now.toISOString(), attempts: event.attempts };
      await tx.insert(auditEvents).values({
        organizationId,
        actorIdentityId,
        action: "platform.outbox.retry",
        entityType: "outbox_event",
        entityId: eventId,
        metadata: { reason, idempotencyKey, topic: event.topic, attempts: event.attempts },
      });
      await tx.insert(platformActionReceipts).values({
        actorIdentityId,
        idempotencyKey,
        action: "platform.outbox.retry",
        targetType: "outbox_event",
        targetId: eventId,
        reason,
        result,
      });
      return { ...result, replayed: false };
    });
  }

  async metrics() {
    const now = new Date();
    const staleAt = new Date(now.getTime() - 5 * 60_000);
    const [billingRows, oldestRows, failedRows, versionRows, activationRows, incidentRows] =
      await Promise.all([
        this.database.db
          .select({
            state: organizations.billingState,
            count: sql<number>`count(*)::int`.mapWith(Number),
          })
          .from(organizations)
          .groupBy(organizations.billingState),
        this.database.db
          .select({ oldestAt: sql<Date | null>`min(${outboxEvents.availableAt})` })
          .from(outboxEvents)
          .where(isNull(outboxEvents.processedAt)),
        this.database.db
          .select({ topic: outboxEvents.topic, lastError: outboxEvents.lastError })
          .from(outboxEvents)
          .where(and(isNull(outboxEvents.processedAt), isNotNull(outboxEvents.lastError)))
          .orderBy(desc(outboxEvents.createdAt))
          .limit(500),
        this.database.db
          .select({
            version: hubHeartbeats.version,
            total: sql<number>`count(*)::int`.mapWith(Number),
            stale:
              sql<number>`count(*) filter (where ${hubHeartbeats.lastSeenAt} < ${staleAt.toISOString()}::timestamptz)::int`.mapWith(
                Number,
              ),
          })
          .from(hubHeartbeats)
          .groupBy(hubHeartbeats.version)
          .orderBy(desc(sql`count(*)`)),
        this.database.db
          .select({
            averageHours: sql<
              number | null
            >`avg(extract(epoch from (${onboardingRecords.activatedAt} - ${organizations.createdAt})) / 3600)`,
            medianHours: sql<
              number | null
            >`percentile_cont(0.5) within group (order by extract(epoch from (${onboardingRecords.activatedAt} - ${organizations.createdAt})) / 3600)`,
          })
          .from(onboardingRecords)
          .innerJoin(organizations, eq(organizations.id, onboardingRecords.organizationId))
          .where(isNotNull(onboardingRecords.activatedAt)),
        this.incidents({ search: "", state: "all", limit: 200 }),
      ]);
    const byBillingState = Object.fromEntries(billingRows.map((row) => [row.state, row.count]));
    const recurring = new Map<string, { topic: string; code: string; count: number }>();
    for (const row of failedRows) {
      const code = failureCode(row.lastError);
      const key = `${row.topic}:${code}`;
      const current = recurring.get(key);
      recurring.set(key, { topic: row.topic, code, count: (current?.count ?? 0) + 1 });
    }
    const oldestAt = oldestRows[0]?.oldestAt;
    const activation = activationRows[0];
    return {
      metrics: {
        tenants: {
          byBillingState,
          active:
            (byBillingState.active ?? 0) +
            (byBillingState.trial_active ?? 0) +
            (byBillingState.grace ?? 0),
        },
        incidents: {
          total: incidentRows.total,
          oldestAgeMinutes: incidentRows.oldestAgeMinutes,
          truncated: incidentRows.truncated,
        },
        jobs: {
          oldestPendingAgeMinutes: oldestAt
            ? Math.max(0, Math.floor((now.getTime() - new Date(oldestAt).getTime()) / 60_000))
            : null,
          recurringFailures: [...recurring.values()]
            .sort((left, right) => right.count - left.count)
            .slice(0, 10),
        },
        hubs: { versions: versionRows },
        activation: {
          averageHours:
            activation?.averageHours == null
              ? null
              : Math.round(Number(activation.averageHours) * 10) / 10,
          medianHours:
            activation?.medianHours == null
              ? null
              : Math.round(Number(activation.medianHours) * 10) / 10,
        },
      },
    };
  }

  private async projectIncidents(now: Date): Promise<PlatformIncident[]> {
    const staleAt = new Date(now.getTime() - 5 * 60_000);
    const [outboxRows, hubRows, missingHubRows, fiscalRows, billingRows, subscriptionRows] =
      await Promise.all([
        this.database.db
          .select({
            id: outboxEvents.id,
            topic: outboxEvents.topic,
            attempts: outboxEvents.attempts,
            payload: outboxEvents.payload,
            lastError: outboxEvents.lastError,
            createdAt: outboxEvents.createdAt,
          })
          .from(outboxEvents)
          .where(and(isNull(outboxEvents.processedAt), isNotNull(outboxEvents.lastError))),
        this.database.db
          .select({
            organizationId: hubHeartbeats.organizationId,
            organizationName: organizations.tradeName,
            unitId: hubHeartbeats.unitId,
            unitName: units.name,
            hubId: hubHeartbeats.hubId,
            version: hubHeartbeats.version,
            lastSeenAt: hubHeartbeats.lastSeenAt,
          })
          .from(hubHeartbeats)
          .innerJoin(organizations, eq(organizations.id, hubHeartbeats.organizationId))
          .innerJoin(units, eq(units.id, hubHeartbeats.unitId))
          .where(lt(hubHeartbeats.lastSeenAt, staleAt)),
        this.database.db
          .select({
            organizationId: units.organizationId,
            organizationName: organizations.tradeName,
            unitId: units.id,
            unitName: units.name,
            createdAt: units.createdAt,
          })
          .from(units)
          .innerJoin(organizations, eq(organizations.id, units.organizationId))
          .leftJoin(hubHeartbeats, eq(hubHeartbeats.unitId, units.id))
          .where(and(eq(units.active, true), isNull(hubHeartbeats.hubId))),
        this.database.db
          .select({ entity: legalEntities, organizationName: organizations.tradeName })
          .from(legalEntities)
          .innerJoin(organizations, eq(organizations.id, legalEntities.organizationId))
          .where(eq(legalEntities.fiscalStatus, "failed")),
        this.database.db
          .select({
            id: organizations.id,
            name: organizations.tradeName,
            state: organizations.billingState,
            changedAt: organizations.billingStateChangedAt,
          })
          .from(organizations)
          .where(inArray(organizations.billingState, ["restricted", "suspended"])),
        this.database.db
          .select({ subscription: subscriptions, organizationName: organizations.tradeName })
          .from(subscriptions)
          .innerJoin(organizations, eq(organizations.id, subscriptions.organizationId))
          .where(eq(subscriptions.reconciliationStatus, "failed")),
      ]);

    return [
      ...outboxRows.map(
        (row): PlatformIncident => ({
          fingerprint: `outbox:${row.id}:${row.attempts}`,
          source: "outbox",
          sourceId: row.id,
          organizationId: uuidValue(row.payload.organizationId),
          organizationName: null,
          unitId: uuidValue(row.payload.unitId),
          unitName: null,
          severity: row.attempts >= 10 ? "critical" : row.attempts >= 5 ? "high" : "medium",
          title: "Falha em job assíncrono",
          detail: {
            topic: row.topic,
            attempts: row.attempts,
            errorCode: failureCode(row.lastError),
          },
          occurredAt: row.createdAt,
        }),
      ),
      ...hubRows.map(
        (row): PlatformIncident => ({
          fingerprint: `hub:${row.unitId}:${row.hubId}:${row.lastSeenAt.getTime()}`,
          source: "hub",
          sourceId: row.hubId,
          organizationId: row.organizationId,
          organizationName: row.organizationName,
          unitId: row.unitId,
          unitName: row.unitName,
          severity: now.getTime() - row.lastSeenAt.getTime() > 60 * 60_000 ? "high" : "medium",
          title: "Hub sem sinal",
          detail: { version: row.version, lastSeenAt: row.lastSeenAt },
          occurredAt: row.lastSeenAt,
        }),
      ),
      ...missingHubRows.map(
        (row): PlatformIncident => ({
          fingerprint: `hub:${row.unitId}:missing:${row.createdAt.getTime()}`,
          source: "hub",
          sourceId: row.unitId,
          organizationId: row.organizationId,
          organizationName: row.organizationName,
          unitId: row.unitId,
          unitName: row.unitName,
          severity: "medium",
          title: "Unidade sem hub registrado",
          detail: {},
          occurredAt: row.createdAt,
        }),
      ),
      ...fiscalRows.map(
        ({ entity, organizationName }): PlatformIncident => ({
          fingerprint: `fiscal:${entity.id}:${entity.updatedAt.getTime()}`,
          source: "fiscal",
          sourceId: entity.id,
          organizationId: entity.organizationId,
          organizationName,
          unitId: null,
          unitName: null,
          severity: "high",
          title: "Integração fiscal com falha",
          detail: { provider: entity.fiscalProvider },
          occurredAt: entity.updatedAt,
        }),
      ),
      ...billingRows.map(
        (row): PlatformIncident => ({
          fingerprint: `billing:${row.id}:state:${row.changedAt.getTime()}`,
          source: "billing",
          sourceId: row.id,
          organizationId: row.id,
          organizationName: row.name,
          unitId: null,
          unitName: null,
          severity: row.state === "suspended" ? "critical" : "high",
          title: row.state === "suspended" ? "Assinatura suspensa" : "Assinatura restrita",
          detail: { state: row.state },
          occurredAt: row.changedAt,
        }),
      ),
      ...subscriptionRows.map(
        ({ subscription, organizationName }): PlatformIncident => ({
          fingerprint: `billing:${subscription.id}:reconciliation:${subscription.updatedAt.getTime()}`,
          source: "billing",
          sourceId: subscription.id,
          organizationId: subscription.organizationId,
          organizationName,
          unitId: null,
          unitName: null,
          severity: "high",
          title: "Conciliação da assinatura falhou",
          detail: { provider: subscription.provider, state: subscription.state },
          occurredAt: subscription.updatedAt,
        }),
      ),
    ];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeIntegrationText(value: unknown) {
  return typeof value === "string" && value.length <= 120 ? value : null;
}

export function maskDocument(value: string | null | undefined) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length <= 4
    ? "*".repeat(digits.length)
    : `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

export function maskEmail(value: string | null | undefined) {
  if (!value) return null;
  const [local, domain] = value.split("@");
  if (!domain) return "***";
  return `${(local ?? "").slice(0, 1)}***@${domain}`;
}

export function maskName(value: string | null | undefined) {
  if (!value) return null;
  return value
    .trim()
    .split(/\s+/)
    .map((part) => `${part.slice(0, 1)}***`)
    .join(" ");
}

export function maskPhone(value: string | null | undefined) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length <= 4
    ? "*".repeat(digits.length)
    : `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

export function maskReference(value: string | null | undefined) {
  if (!value) return null;
  return value.length <= 6 ? "***" : `${value.slice(0, 3)}***${value.slice(-3)}`;
}

export function failureCode(value: string | null | undefined) {
  const candidate = (value ?? "UNKNOWN").trim().match(/[A-Z][A-Z0-9_.-]{2,63}/i)?.[0];
  return (candidate ?? "UNKNOWN").toUpperCase();
}

export function safeAuditMetadata(value: Record<string, unknown>) {
  const allowed = [
    "reason",
    "source",
    "status",
    "code",
    "attachmentId",
    "topic",
    "attempts",
    "previousEndsAt",
    "endsAt",
    "durationMonths",
    "extended",
  ];
  return allowed.reduce<Record<string, string | number | boolean>>((result, key) => {
    const candidate = value[key];
    if (typeof candidate === "number" || typeof candidate === "boolean") result[key] = candidate;
    if (typeof candidate === "string") result[key] = candidate.slice(0, 160);
    return result;
  }, {});
}

function uuidValue(value: unknown) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function severityRank(value: IncidentSeverity) {
  return { low: 1, medium: 2, high: 3, critical: 4 }[value];
}

export const PILOT_ACCESS_MONTHS = 6;

export function resolvePilotAccessEndsAt(currentEndsAt: Date, grantedAt: Date) {
  const sixMonthsFromGrant = addUtcMonths(grantedAt, PILOT_ACCESS_MONTHS);
  return {
    endsAt: currentEndsAt > sixMonthsFromGrant ? currentEndsAt : sixMonthsFromGrant,
    extended: currentEndsAt < sixMonthsFromGrant,
  };
}

function tenantRegistrationFingerprint(input: PlatformTenantRegistration) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function addUtcMonths(date: Date, months: number) {
  const result = new Date(date);
  const targetMonth = (result.getUTCMonth() + months) % 12;
  result.setUTCMonth(result.getUTCMonth() + months);
  if (result.getUTCMonth() !== targetMonth) result.setUTCDate(0);
  return result;
}
