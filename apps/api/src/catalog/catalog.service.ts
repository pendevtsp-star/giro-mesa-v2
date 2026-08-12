import { randomUUID } from "node:crypto";
import type { ContactRequestInput, TrialApplicationRequestInput } from "@giromesa/contracts";
import {
  commercialCatalogVersions,
  commercialPlans,
  contactRequests,
  outboxEvents,
  trialApplications,
} from "@giromesa/db";
import { getCommercialPlan } from "@giromesa/domain";
import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";

@Injectable()
export class CatalogService {
  constructor(private readonly database: DatabaseService) {}

  async publicCatalog() {
    const [catalog] = await this.database.db
      .select()
      .from(commercialCatalogVersions)
      .where(eq(commercialCatalogVersions.status, "published"))
      .orderBy(desc(commercialCatalogVersions.version))
      .limit(1);
    if (!catalog)
      throw new ServiceUnavailableException({
        code: "CATALOG_NOT_PUBLISHED",
        message: "Catálogo comercial indisponível.",
      });
    const plans = await this.database.db
      .select({
        slug: commercialPlans.slug,
        name: commercialPlans.name,
        monthlyPriceCents: commercialPlans.monthlyPriceCents,
        annualPriceCents: commercialPlans.annualPriceCents,
        includedUnits: commercialPlans.includedUnits,
        entitlements: commercialPlans.entitlements,
      })
      .from(commercialPlans)
      .where(and(eq(commercialPlans.catalogVersionId, catalog.id)))
      .orderBy(commercialPlans.monthlyPriceCents);
    return {
      version: catalog.version,
      publishedAt: catalog.publishedAt,
      plans: plans.map((plan) => {
        const presentation = getCommercialPlan(plan.slug);
        return {
          ...plan,
          description: presentation?.description ?? "",
          features: presentation ? [...presentation.features] : [],
          featured: presentation && "featured" in presentation ? presentation.featured : false,
        };
      }),
    };
  }

  async createTrialApplication(input: TrialApplicationRequestInput) {
    const { name, email, phone, businessName, segment, planSlug } = input;
    const application = { id: randomUUID(), createdAt: new Date() };
    await this.database.db.insert(trialApplications).values({
      ...application,
      name,
      email,
      phone,
      businessName,
      segment,
      planSlug,
      consentedAt: new Date(),
    });
    await this.database.db.insert(outboxEvents).values({
      topic: "trial.application_created",
      aggregateType: "trial_application",
      aggregateId: application.id,
      payload: { applicationId: application.id },
    });
    return application;
  }

  async createContactRequest(input: ContactRequestInput) {
    const contact = { id: randomUUID(), createdAt: new Date() };
    await this.database.db.insert(contactRequests).values({
      ...contact,
      name: input.name,
      email: input.email,
      phone: input.phone,
      message: input.message,
      consentedAt: new Date(),
    });
    await this.database.db.insert(outboxEvents).values({
      topic: "contact.request_created",
      aggregateType: "contact_request",
      aggregateId: contact.id,
      payload: { contactRequestId: contact.id },
    });
    return contact;
  }
}
