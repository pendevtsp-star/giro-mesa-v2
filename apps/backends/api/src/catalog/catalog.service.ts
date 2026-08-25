import type { ContactRequestInput, TrialApplicationRequestInput } from "@giromesa/contracts";
import {
  billingCheckouts,
  commercialCampaigns,
  commercialCatalogVersions,
  commercialExperimentImpressions,
  commercialExperiments,
  commercialMediaAssets,
  commercialPlans,
  commercialPromotions,
  contactRequests,
  outboxEvents,
  trialApplications,
} from "@giromesa/db";
import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { commercialLandingSchema, commercialSeoSchema } from "../platform/platform.schemas.js";
import {
  assignCommercialExperimentVariant,
  commercialVisitorHash,
  resolveCommercialPromotion,
} from "./commercial.rules.js";
import { activateDueCommercialCatalog } from "./commercial-publication.js";

@Injectable()
export class CatalogService {
  constructor(private readonly database: DatabaseService) {}

  async publicCatalog(visitorId?: string) {
    const now = new Date();
    await this.database.db.transaction((tx) => activateDueCommercialCatalog(tx, now));
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
    const parsedLanding = commercialLandingSchema.safeParse(catalog.landing);
    const parsedSeo = commercialSeoSchema.safeParse(catalog.seo);
    if (!parsedLanding.success || !parsedSeo.success)
      throw new ServiceUnavailableException({ code: "COMMERCIAL_LANDING_NOT_PUBLISHED" });
    const [plans, promotions, experiments] = await Promise.all([
      this.database.db
        .select()
        .from(commercialPlans)
        .where(eq(commercialPlans.catalogVersionId, catalog.id))
        .orderBy(asc(commercialPlans.displayOrder), asc(commercialPlans.monthlyPriceCents)),
      this.database.db
        .select()
        .from(commercialPromotions)
        .where(
          and(
            eq(commercialPromotions.catalogVersionId, catalog.id),
            eq(commercialPromotions.active, true),
            isNull(commercialPromotions.code),
          ),
        ),
      this.database.db
        .select()
        .from(commercialExperiments)
        .where(
          and(
            eq(commercialExperiments.catalogVersionId, catalog.id),
            eq(commercialExperiments.status, "active"),
            or(isNull(commercialExperiments.startsAt), lte(commercialExperiments.startsAt, now)),
            or(isNull(commercialExperiments.endsAt), gt(commercialExperiments.endsAt, now)),
          ),
        )
        .orderBy(asc(commercialExperiments.slug)),
    ]);
    const promotionIds = promotions.map((promotion) => promotion.id);
    const redemptionCounts = promotionIds.length
      ? await this.database.db
          .select({
            promotionId: billingCheckouts.promotionId,
            count: sql<number>`count(*)::int`.mapWith(Number),
          })
          .from(billingCheckouts)
          .where(
            and(
              inArray(billingCheckouts.promotionId, promotionIds),
              notInArray(billingCheckouts.status, ["failed", "canceled", "expired"]),
              or(
                isNotNull(billingCheckouts.confirmedAt),
                isNull(billingCheckouts.expiresAt),
                gt(billingCheckouts.expiresAt, now),
              ),
            ),
          )
          .groupBy(billingCheckouts.promotionId)
      : [];
    const usedByPromotion = new Map(redemptionCounts.map((row) => [row.promotionId, row.count]));
    const availablePromotions = promotions.filter(
      (promotion) =>
        promotion.redemptionLimit === null ||
        (usedByPromotion.get(promotion.id) ?? 0) < promotion.redemptionLimit,
    );
    const mediaIds = [parsedLanding.data.hero.mediaId, parsedSeo.data.ogMediaId].filter(
      (id): id is string => Boolean(id),
    );
    const media = mediaIds.length
      ? await this.database.db
          .select()
          .from(commercialMediaAssets)
          .where(
            and(
              inArray(commercialMediaAssets.id, mediaIds),
              isNull(commercialMediaAssets.deletedAt),
            ),
          )
      : [];
    const mediaById = new Map(media.map((asset) => [asset.id, asset]));
    const resolveMedia = (id: string | undefined) => {
      if (!id) return null;
      const asset = mediaById.get(id);
      if (!asset) throw new ServiceUnavailableException({ code: "COMMERCIAL_MEDIA_NOT_AVAILABLE" });
      const metadata = asset.metadata as { width?: unknown; height?: unknown };
      return {
        url: asset.url,
        alt: asset.alt,
        ...(typeof metadata.width === "number" ? { width: metadata.width } : {}),
        ...(typeof metadata.height === "number" ? { height: metadata.height } : {}),
      };
    };
    const { mediaId: heroMediaId, ...hero } = parsedLanding.data.hero;
    const { ogMediaId, ...seo } = parsedSeo.data;
    return {
      version: catalog.version,
      publishedAt: catalog.publishedAt,
      landing: { ...parsedLanding.data, hero: { ...hero, media: resolveMedia(heroMediaId) } },
      seo: { ...seo, ogImage: resolveMedia(ogMediaId) },
      experiments: experiments.map((experiment) => ({
        slug: experiment.slug,
        variant: visitorId
          ? assignCommercialExperimentVariant(experiment.slug, experiment.variants, visitorId)
          : null,
      })),
      plans: plans.map((plan) => {
        const offers = Object.fromEntries(
          (["monthly", "annual"] as const).map((cycle) => {
            const originalPriceCents =
              cycle === "monthly" ? plan.monthlyPriceCents : plan.annualPriceCents;
            const resolved = resolveCommercialPromotion(availablePromotions, {
              planSlug: plan.slug,
              cycle,
              basePriceCents: originalPriceCents,
              newCustomer: true,
              now,
            });
            return [
              cycle,
              {
                originalPriceCents,
                priceCents: resolved?.finalPriceCents ?? originalPriceCents,
                promotion: resolved
                  ? {
                      id: resolved.id,
                      name: resolved.name,
                      type: resolved.type,
                      value: resolved.value,
                      endsAt: resolved.endsAt,
                    }
                  : null,
              },
            ];
          }),
        );
        return {
          slug: plan.slug,
          name: plan.name,
          description: plan.description,
          monthlyPriceCents: plan.monthlyPriceCents,
          annualPriceCents: plan.annualPriceCents,
          includedUnits: plan.includedUnits,
          entitlements: plan.entitlements,
          features: plan.features,
          featured: plan.featured,
          displayOrder: plan.displayOrder,
          ctaLabel: plan.ctaLabel,
          ctaHref: plan.ctaHref,
          offers,
        };
      }),
    };
  }

  async recordExperimentImpression(input: {
    catalogVersion: number;
    experimentSlug: string;
    variantKey: string;
    visitorId: string;
  }) {
    return this.database.db.transaction(async (tx) => {
      await activateDueCommercialCatalog(tx);
      const now = new Date();
      const [experiment] = await tx
        .select({
          catalogVersionId: commercialExperiments.catalogVersionId,
          variants: commercialExperiments.variants,
        })
        .from(commercialExperiments)
        .innerJoin(
          commercialCatalogVersions,
          eq(commercialCatalogVersions.id, commercialExperiments.catalogVersionId),
        )
        .where(
          and(
            eq(commercialCatalogVersions.status, "published"),
            eq(commercialCatalogVersions.version, input.catalogVersion),
            eq(commercialExperiments.slug, input.experimentSlug),
            eq(commercialExperiments.status, "active"),
            or(isNull(commercialExperiments.startsAt), lte(commercialExperiments.startsAt, now)),
            or(isNull(commercialExperiments.endsAt), gt(commercialExperiments.endsAt, now)),
          ),
        )
        .limit(1);
      const assigned = experiment
        ? assignCommercialExperimentVariant(
            input.experimentSlug,
            experiment.variants,
            input.visitorId,
          )
        : null;
      if (!experiment || assigned?.key !== input.variantKey)
        throw new BadRequestException({ code: "COMMERCIAL_EXPERIMENT_ASSIGNMENT_INVALID" });
      const [created] = await tx
        .insert(commercialExperimentImpressions)
        .values({
          catalogVersionId: experiment.catalogVersionId,
          experimentSlug: input.experimentSlug,
          variantKey: input.variantKey,
          visitorHash: commercialVisitorHash(input.visitorId),
        })
        .onConflictDoNothing()
        .returning({ id: commercialExperimentImpressions.id });
      return { recorded: Boolean(created), replayed: !created };
    });
  }

  async createTrialApplication(input: TrialApplicationRequestInput) {
    const { name, email, phone, businessName, segment, planSlug } = input;
    return this.database.db.transaction(async (tx) => {
      const attribution = await this.validateAttribution(tx, input.attribution);
      const [application] = await tx
        .insert(trialApplications)
        .values({
          name,
          email,
          phone,
          businessName,
          segment,
          planSlug,
          ...attribution,
          consentedAt: new Date(),
        })
        .returning({ id: trialApplications.id, createdAt: trialApplications.createdAt });
      if (!application) throw new Error("Trial application was not created");
      await tx.insert(outboxEvents).values({
        topic: "trial.application_created",
        aggregateType: "trial_application",
        aggregateId: application.id,
        payload: { applicationId: application.id },
      });
      return application;
    });
  }

  async createContactRequest(input: ContactRequestInput) {
    return this.database.db.transaction(async (tx) => {
      const attribution = await this.validateAttribution(tx, input.attribution);
      const [contact] = await tx
        .insert(contactRequests)
        .values({
          name: input.name,
          email: input.email,
          phone: input.phone,
          message: input.message,
          ...attribution,
          consentedAt: new Date(),
        })
        .returning({ id: contactRequests.id, createdAt: contactRequests.createdAt });
      if (!contact) throw new Error("Contact request was not created");
      await tx.insert(outboxEvents).values({
        topic: "contact.request_created",
        aggregateType: "contact_request",
        aggregateId: contact.id,
        payload: { contactRequestId: contact.id },
      });
      return contact;
    });
  }

  private async validateAttribution(
    tx: Parameters<Parameters<typeof this.database.db.transaction>[0]>[0],
    attribution: TrialApplicationRequestInput["attribution"] | ContactRequestInput["attribution"],
  ) {
    await activateDueCommercialCatalog(tx);
    const [catalog] = await tx
      .select()
      .from(commercialCatalogVersions)
      .where(eq(commercialCatalogVersions.status, "published"))
      .orderBy(desc(commercialCatalogVersions.version))
      .limit(1);
    const landing = commercialLandingSchema.safeParse(catalog?.landing);
    if (!catalog || !landing.success)
      throw new ServiceUnavailableException({ code: "COMMERCIAL_CONSENT_VERSION_UNAVAILABLE" });
    if (
      !attribution?.landingVersion ||
      attribution.landingVersion !== catalog.version ||
      attribution.termsVersion !== landing.data.legal.terms.version ||
      attribution.privacyVersion !== landing.data.legal.privacy.version
    )
      throw new BadRequestException({ code: "COMMERCIAL_CONSENT_VERSION_MISMATCH" });
    let campaignSlug: string | null = null;
    if (attribution.campaignSlug) {
      const now = new Date();
      const [campaign] = await tx
        .select({ slug: commercialCampaigns.slug })
        .from(commercialCampaigns)
        .where(
          and(
            eq(commercialCampaigns.slug, attribution.campaignSlug),
            eq(commercialCampaigns.status, "active"),
            or(isNull(commercialCampaigns.startsAt), lte(commercialCampaigns.startsAt, now)),
            or(isNull(commercialCampaigns.endsAt), gt(commercialCampaigns.endsAt, now)),
          ),
        )
        .limit(1);
      campaignSlug = campaign?.slug ?? null;
    }
    return {
      campaignSlug,
      landingVersion: attribution.landingVersion,
      utmSource: attribution.utmSource ?? null,
      utmMedium: attribution.utmMedium ?? null,
      utmCampaign: attribution.utmCampaign ?? null,
      utmTerm: attribution.utmTerm ?? null,
      utmContent: attribution.utmContent ?? null,
      termsVersion: attribution.termsVersion,
      privacyVersion: attribution.privacyVersion,
      ...(await this.validatedExperimentAttribution(tx, catalog.id, attribution)),
    };
  }

  private async validatedExperimentAttribution(
    tx: Parameters<Parameters<typeof this.database.db.transaction>[0]>[0],
    catalogVersionId: string,
    attribution: NonNullable<TrialApplicationRequestInput["attribution"]>,
  ) {
    if (!attribution.experimentSlug && !attribution.variantKey && !attribution.visitorId)
      return {
        experimentSlug: null,
        experimentVariantKey: null,
        experimentVisitorHash: null,
      };
    if (!attribution.experimentSlug || !attribution.variantKey || !attribution.visitorId)
      throw new BadRequestException({ code: "COMMERCIAL_EXPERIMENT_ATTRIBUTION_INCOMPLETE" });
    const now = new Date();
    const [experiment] = await tx
      .select({ variants: commercialExperiments.variants })
      .from(commercialExperiments)
      .where(
        and(
          eq(commercialExperiments.catalogVersionId, catalogVersionId),
          eq(commercialExperiments.slug, attribution.experimentSlug),
          eq(commercialExperiments.status, "active"),
          or(isNull(commercialExperiments.startsAt), lte(commercialExperiments.startsAt, now)),
          or(isNull(commercialExperiments.endsAt), gt(commercialExperiments.endsAt, now)),
        ),
      )
      .limit(1);
    const assigned = experiment
      ? assignCommercialExperimentVariant(
          attribution.experimentSlug,
          experiment.variants,
          attribution.visitorId,
        )
      : null;
    if (assigned?.key !== attribution.variantKey)
      throw new BadRequestException({ code: "COMMERCIAL_EXPERIMENT_ASSIGNMENT_INVALID" });
    return {
      experimentSlug: attribution.experimentSlug,
      experimentVariantKey: attribution.variantKey,
      experimentVisitorHash: commercialVisitorHash(attribution.visitorId),
    };
  }
}
