import {
  contactRequests,
  hubHeartbeats,
  legalEntities,
  organizations,
  outboxEvents,
  trialApplications,
  trials,
  units,
} from "@giromesa/db";
import { Injectable } from "@nestjs/common";
import { desc, eq, gte, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";

@Injectable()
export class PlatformService {
  constructor(private readonly database: DatabaseService) {}

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
            sql<number>`count(*) filter (where ${units.active} = true and (${hubHeartbeats.lastSeenAt} is null or ${hubHeartbeats.lastSeenAt} < ${staleHeartbeat}))`.mapWith(
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
    };
  }
}
