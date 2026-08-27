import {
  accountantRequests,
  auditEvents,
  contactRequests,
  fiscalProfiles,
  hubHeartbeats,
  legalEntities,
  organizations,
  outboxEvents,
  trialApplications,
  trials,
  units,
} from "@giromesa/db";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";

@Injectable()
export class PlatformService {
  constructor(private readonly database: DatabaseService) {}

  async setAccountantAttachmentLegalHold(
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    requestId: string,
    attachmentId: string,
    active: boolean,
  ) {
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`accountant-request:${organizationId}:${unitId}:${requestId}`}, 0))`,
      );
      const [request] = await tx
        .select({ attachments: accountantRequests.attachments })
        .from(accountantRequests)
        .where(
          and(
            eq(accountantRequests.organizationId, organizationId),
            eq(accountantRequests.unitId, unitId),
            eq(accountantRequests.id, requestId),
          ),
        )
        .for("update")
        .limit(1);
      if (!request) throw new NotFoundException({ code: "ACCOUNTANT_REQUEST_NOT_FOUND" });
      const attachment = request.attachments.find((candidate) => candidate.id === attachmentId);
      if (!attachment) throw new NotFoundException({ code: "ACCOUNTANT_ATTACHMENT_NOT_FOUND" });
      if (active && (attachment.deletedAt || attachment.purgedAt))
        throw new ConflictException({ code: "ACCOUNTANT_ATTACHMENT_ALREADY_DELETED" });
      if (Boolean(attachment.legalHold) === active)
        return { attachmentId, legalHold: active, replayed: true };
      await tx
        .update(accountantRequests)
        .set({
          attachments: request.attachments.map((candidate) =>
            candidate.id === attachmentId ? { ...candidate, legalHold: active } : candidate,
          ),
          updatedAt: new Date(),
        })
        .where(eq(accountantRequests.id, requestId));
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId,
        action: active
          ? "accounting.request.attachment.legal_hold_applied"
          : "accounting.request.attachment.legal_hold_released",
        entityType: "accountant_request",
        entityId: requestId,
        metadata: { attachmentId },
      });
      return { attachmentId, legalHold: active, replayed: false };
    });
  }

  async overview() {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
    const staleHeartbeat = new Date(now.getTime() - 5 * 60_000);
    const [
      counts,
      recentTrials,
      recentContacts,
      recentOrganizations,
      healthRows,
      fiscalRows,
      fiscalIntegrationRows,
      jobRows,
      applicationRows,
      activationRows,
    ] = await Promise.all([
      this.database.db
        .select({
          organizations: sql<number>`count(distinct ${organizations.id})::int`,
          units: sql<number>`count(distinct ${units.id})::int`,
          activeTrials: sql<number>`count(distinct ${trials.id}) filter (where ${trials.endsAt} > now())::int`,
        })
        .from(organizations)
        .leftJoin(units, eq(units.organizationId, organizations.id))
        .leftJoin(trials, eq(trials.organizationId, organizations.id)),
      this.database.db
        .select({
          id: trialApplications.id,
          name: trialApplications.name,
          email: trialApplications.email,
          phone: trialApplications.phone,
          businessName: trialApplications.businessName,
          planSlug: trialApplications.planSlug,
          createdAt: trialApplications.createdAt,
        })
        .from(trialApplications)
        .orderBy(desc(trialApplications.createdAt))
        .limit(20),
      this.database.db
        .select({
          id: contactRequests.id,
          name: contactRequests.name,
          email: contactRequests.email,
          phone: contactRequests.phone,
          message: contactRequests.message,
          createdAt: contactRequests.createdAt,
        })
        .from(contactRequests)
        .orderBy(desc(contactRequests.createdAt))
        .limit(20),
      this.database.db
        .select({
          id: organizations.id,
          name: organizations.tradeName,
          billingState: organizations.billingState,
          createdAt: organizations.createdAt,
        })
        .from(organizations)
        .orderBy(desc(organizations.createdAt))
        .limit(20),
      this.database.db
        .select({
          organizationId: units.organizationId,
          units: sql<number>`count(*) filter (where ${units.active} = true)`.mapWith(Number),
          staleHubs:
            sql<number>`count(*) filter (where ${units.active} = true and (${hubHeartbeats.lastSeenAt} is null or ${hubHeartbeats.lastSeenAt} < ${staleHeartbeat.toISOString()}::timestamptz))`.mapWith(
              Number,
            ),
        })
        .from(units)
        .leftJoin(hubHeartbeats, eq(hubHeartbeats.unitId, units.id))
        .groupBy(units.organizationId),
      this.database.db
        .select({
          organizationId: legalEntities.organizationId,
          failed:
            sql<number>`count(*) filter (where ${legalEntities.fiscalStatus} = 'failed')`.mapWith(
              Number,
            ),
        })
        .from(legalEntities)
        .groupBy(legalEntities.organizationId),
      this.database.db
        .select({
          organizationId: organizations.id,
          organizationName: organizations.tradeName,
          unitId: units.id,
          unitName: units.name,
          document: legalEntities.document,
          provider: fiscalProfiles.provider,
          environment: fiscalProfiles.environment,
          settings: fiscalProfiles.settings,
          updatedAt: fiscalProfiles.updatedAt,
        })
        .from(units)
        .innerJoin(organizations, eq(organizations.id, units.organizationId))
        .leftJoin(
          fiscalProfiles,
          and(
            eq(fiscalProfiles.organizationId, units.organizationId),
            eq(fiscalProfiles.unitId, units.id),
          ),
        )
        .leftJoin(legalEntities, eq(legalEntities.id, units.legalEntityId))
        .where(eq(units.active, true))
        .orderBy(asc(organizations.tradeName), asc(units.name)),
      this.database.db
        .select({
          pending: sql<number>`count(*) filter (where ${outboxEvents.processedAt} is null)`.mapWith(
            Number,
          ),
          failed:
            sql<number>`count(*) filter (where ${outboxEvents.processedAt} is null and ${outboxEvents.lastError} is not null)`.mapWith(
              Number,
            ),
        })
        .from(outboxEvents),
      this.database.db
        .select({ applications: sql<number>`count(*)`.mapWith(Number) })
        .from(trialApplications)
        .where(gte(trialApplications.createdAt, sevenDaysAgo)),
      this.database.db
        .select({ activations: sql<number>`count(*)`.mapWith(Number) })
        .from(trials)
        .where(gte(trials.startsAt, sevenDaysAgo)),
    ]);

    const healthByOrg = new Map(healthRows.map((row) => [row.organizationId, row]));
    const fiscalByOrg = new Map(fiscalRows.map((row) => [row.organizationId, row.failed]));
    const applications = applicationRows[0]?.applications ?? 0;
    const activations = activationRows[0]?.activations ?? 0;
    const tenantHealth = recentOrganizations
      .map((organization) => {
        const health = healthByOrg.get(organization.id);
        const failedIntegrations = fiscalByOrg.get(organization.id) ?? 0;
        const issues =
          (health?.staleHubs ?? 0) +
          failedIntegrations +
          (["restricted", "suspended"].includes(organization.billingState) ? 1 : 0);
        return {
          ...organization,
          unitCount: health?.units ?? 0,
          staleHubs: health?.staleHubs ?? 0,
          failedIntegrations,
          issues,
          tone: issues > 1 ? "danger" : issues ? "warning" : "success",
        };
      })
      .sort((left, right) => right.issues - left.issues);

    return {
      counts: counts[0] ?? { organizations: 0, units: 0, activeTrials: 0 },
      health: {
        pendingJobs: jobRows[0]?.pending ?? 0,
        failedJobs: jobRows[0]?.failed ?? 0,
        staleHubs: healthRows.reduce((total, row) => total + row.staleHubs, 0),
        failedIntegrations: fiscalRows.reduce((total, row) => total + row.failed, 0),
      },
      trialFunnel: {
        applications,
        activations,
        conversionPercent: applications ? Math.round((activations / applications) * 100) : 0,
      },
      recentTrialApplications: recentTrials,
      recentContacts,
      recentOrganizations: tenantHealth,
      fiscalIntegrations: fiscalIntegrationRows.map((row) => ({
        organizationId: row.organizationId,
        organizationName: row.organizationName,
        unitId: row.unitId,
        unitName: row.unitName,
        document: row.document,
        provider: row.provider,
        environment: row.environment,
        profileUpdatedAt: row.updatedAt,
        ...fiscalIntegrationStatus(row.settings),
      })),
    };
  }
}

export function fiscalIntegrationStatus(settings: unknown) {
  const focus = objectValue(objectValue(settings).focus);
  const lastError = objectValue(focus.lastError);
  return {
    companyId: stringValue(focus.companyId),
    status: stringValue(focus.status),
    certificateValidUntil: stringValue(focus.certificateValidUntil),
    lastCheckedAt: stringValue(focus.lastCheckedAt),
    hasHomologationCredential: secretEnvelopePresent(focus.tokenHomologation),
    hasProductionCredential: secretEnvelopePresent(focus.tokenProduction),
    lastErrorCode: stringValue(lastError.code),
    lastErrorMessage: stringValue(lastError.message),
  };
}

function secretEnvelopePresent(value: unknown) {
  const envelope = objectValue(value);
  return Boolean(
    stringValue(envelope.encryptedSecret) &&
      stringValue(envelope.iv) &&
      stringValue(envelope.authTag),
  );
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}
