import { contactRequests, organizations, trialApplications, trials, units } from "@giromesa/db";
import { Injectable } from "@nestjs/common";
import { desc, eq, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";

@Injectable()
export class PlatformService {
  constructor(private readonly database: DatabaseService) {}

  async overview() {
    const [counts, recentTrials, recentContacts, recentOrganizations] = await Promise.all([
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
    ]);

    return {
      counts: counts[0] ?? { organizations: 0, units: 0, activeTrials: 0 },
      recentTrialApplications: recentTrials,
      recentContacts,
      recentOrganizations,
    };
  }
}
