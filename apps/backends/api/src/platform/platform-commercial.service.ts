import { createHash, randomBytes } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import {
  auditEvents,
  billingCheckouts,
  commercialCampaigns,
  commercialCatalogVersions,
  commercialExperimentImpressions,
  commercialExperiments,
  commercialLeadStates,
  commercialMediaAssets,
  commercialPlans,
  commercialPromotions,
  contactRequests,
  type Database,
  outboxEvents,
  platformActionReceipts,
  trialApplications,
} from "@giromesa/db";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { automaticPromotionsOverlap } from "../catalog/commercial.rules.js";
import { activateDueCommercialCatalog } from "../catalog/commercial-publication.js";
import { DatabaseService } from "../database/database.module.js";
import type {
  CommercialCampaignInput,
  CommercialDraftCreate,
  CommercialDraftUpdate,
  CommercialLeadQuery,
  CommercialLeadStateInput,
  CommercialMediaUpload,
  CommercialPublish,
  CommercialRollback,
} from "./platform.schemas.js";
import { maskEmail, maskName, maskPhone } from "./platform-control.service.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

@Injectable()
export class PlatformCommercialService {
  constructor(private readonly database: DatabaseService) {}

  async overview() {
    await this.database.db.transaction((tx) => activateDueCommercialCatalog(tx));
    const [versions, media, campaigns, metrics] = await Promise.all([
      this.database.db
        .select()
        .from(commercialCatalogVersions)
        .orderBy(desc(commercialCatalogVersions.version)),
      this.database.db
        .select()
        .from(commercialMediaAssets)
        .where(isNull(commercialMediaAssets.deletedAt))
        .orderBy(desc(commercialMediaAssets.createdAt)),
      this.database.db
        .select()
        .from(commercialCampaigns)
        .orderBy(desc(commercialCampaigns.createdAt)),
      this.metrics(),
    ]);
    return {
      publication: {
        published: versions.find((version) => version.status === "published") ?? null,
        scheduled: versions.find((version) => version.status === "scheduled") ?? null,
        editable:
          versions.find((version) => ["draft", "approved"].includes(version.status)) ?? null,
      },
      versions,
      media,
      campaigns,
      metrics,
    };
  }

  async bundle(versionId: string) {
    const [version] = await this.database.db
      .select()
      .from(commercialCatalogVersions)
      .where(eq(commercialCatalogVersions.id, versionId))
      .limit(1);
    if (!version) throw new NotFoundException({ code: "COMMERCIAL_VERSION_NOT_FOUND" });
    const [plans, promotions, experiments] = await Promise.all([
      this.database.db
        .select()
        .from(commercialPlans)
        .where(eq(commercialPlans.catalogVersionId, versionId))
        .orderBy(asc(commercialPlans.displayOrder), asc(commercialPlans.monthlyPriceCents)),
      this.database.db
        .select()
        .from(commercialPromotions)
        .where(eq(commercialPromotions.catalogVersionId, versionId))
        .orderBy(asc(commercialPromotions.startsAt)),
      this.database.db
        .select()
        .from(commercialExperiments)
        .where(eq(commercialExperiments.catalogVersionId, versionId))
        .orderBy(asc(commercialExperiments.slug)),
    ]);
    return { ...version, plans, promotions, experiments };
  }

  async createDraft(actorIdentityId: string, idempotencyKey: string, input: CommercialDraftCreate) {
    return this.action(
      actorIdentityId,
      idempotencyKey,
      "commercial.catalog.draft_created",
      `new:${payloadHash(input)}`,
      input.reason,
      async (tx) => {
        await this.lockCatalog(tx);
        const [editable] = await tx
          .select({ id: commercialCatalogVersions.id })
          .from(commercialCatalogVersions)
          .where(inArray(commercialCatalogVersions.status, ["draft", "approved", "scheduled"]))
          .limit(1);
        if (editable) throw new ConflictException({ code: "COMMERCIAL_DRAFT_ALREADY_EXISTS" });
        const [source] = input.sourceVersionId
          ? await tx
              .select()
              .from(commercialCatalogVersions)
              .where(eq(commercialCatalogVersions.id, input.sourceVersionId))
              .limit(1)
          : await tx
              .select()
              .from(commercialCatalogVersions)
              .where(eq(commercialCatalogVersions.status, "published"))
              .limit(1);
        if (!source) throw new NotFoundException({ code: "COMMERCIAL_SOURCE_VERSION_NOT_FOUND" });
        const [next] = await tx
          .select({
            version:
              sql<number>`coalesce(max(${commercialCatalogVersions.version}), 0)::int + 1`.mapWith(
                Number,
              ),
          })
          .from(commercialCatalogVersions);
        const [created] = await tx
          .insert(commercialCatalogVersions)
          .values({
            version: next?.version ?? 1,
            status: "draft",
            sourceVersionId: source.id,
            createdByIdentityId: actorIdentityId,
            landing: source.landing,
            seo: source.seo,
          })
          .returning({
            id: commercialCatalogVersions.id,
            version: commercialCatalogVersions.version,
          });
        if (!created) throw new Error("Commercial draft was not created");
        await this.copyVersionRows(tx, source.id, created.id);
        return { ...created, status: "draft" as const };
      },
    );
  }

  async updateDraft(
    actorIdentityId: string,
    versionId: string,
    idempotencyKey: string,
    input: CommercialDraftUpdate,
  ) {
    return this.action(
      actorIdentityId,
      idempotencyKey,
      "commercial.catalog.draft_updated",
      `${versionId}:${payloadHash(input)}`,
      input.reason,
      async (tx) => {
        await this.lockCatalog(tx);
        const [version] = await tx
          .select({ id: commercialCatalogVersions.id, status: commercialCatalogVersions.status })
          .from(commercialCatalogVersions)
          .where(eq(commercialCatalogVersions.id, versionId))
          .limit(1);
        if (!version) throw new NotFoundException({ code: "COMMERCIAL_VERSION_NOT_FOUND" });
        if (version.status !== "draft")
          throw new ConflictException({ code: "COMMERCIAL_DRAFT_NOT_EDITABLE" });
        await this.assertMediaReferences(tx, input.landing, input.seo);
        for (let index = 0; index < input.promotions.length; index += 1) {
          const promotion = input.promotions[index];
          if (!promotion) continue;
          for (const compared of input.promotions.slice(index + 1)) {
            if (automaticPromotionsOverlap(promotion, compared))
              throw new BadRequestException({ code: "COMMERCIAL_AUTOMATIC_PROMOTION_OVERLAP" });
          }
        }
        const now = new Date();
        await tx
          .update(commercialCatalogVersions)
          .set({ landing: input.landing, seo: input.seo, updatedAt: now })
          .where(eq(commercialCatalogVersions.id, versionId));
        await tx
          .delete(commercialPromotions)
          .where(eq(commercialPromotions.catalogVersionId, versionId));
        await tx
          .delete(commercialExperiments)
          .where(eq(commercialExperiments.catalogVersionId, versionId));
        await tx.delete(commercialPlans).where(eq(commercialPlans.catalogVersionId, versionId));
        await tx
          .insert(commercialPlans)
          .values(
            input.plans.map((plan) => ({ ...plan, catalogVersionId: versionId, updatedAt: now })),
          );
        if (input.promotions.length) {
          await tx.insert(commercialPromotions).values(
            input.promotions.map(({ id, ...promotion }) => ({
              ...(id ? { id } : {}),
              ...promotion,
              code: promotion.code ?? null,
              endsAt: promotion.endsAt ?? null,
              redemptionLimit: promotion.redemptionLimit ?? null,
              catalogVersionId: versionId,
              updatedAt: now,
            })),
          );
        }
        if (input.experiments.length) {
          await tx.insert(commercialExperiments).values(
            input.experiments.map((experiment) => ({
              ...experiment,
              startsAt: experiment.startsAt ?? null,
              endsAt: experiment.endsAt ?? null,
              catalogVersionId: versionId,
              updatedAt: now,
            })),
          );
        }
        return { id: versionId, status: "draft" as const, updatedAt: now.toISOString() };
      },
    );
  }

  async approve(
    actorIdentityId: string,
    versionId: string,
    idempotencyKey: string,
    reason: string,
  ) {
    return this.action(
      actorIdentityId,
      idempotencyKey,
      "commercial.catalog.approved",
      versionId,
      reason,
      async (tx) => {
        await this.lockCatalog(tx);
        const [version] = await tx
          .select({ createdByIdentityId: commercialCatalogVersions.createdByIdentityId })
          .from(commercialCatalogVersions)
          .where(eq(commercialCatalogVersions.id, versionId))
          .limit(1);
        if (version?.createdByIdentityId === actorIdentityId)
          throw new ConflictException({ code: "COMMERCIAL_FOUR_EYES_REQUIRED" });
        const [updated] = await tx
          .update(commercialCatalogVersions)
          .set({
            status: "approved",
            approvedAt: new Date(),
            approvedByIdentityId: actorIdentityId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(commercialCatalogVersions.id, versionId),
              eq(commercialCatalogVersions.status, "draft"),
            ),
          )
          .returning({
            id: commercialCatalogVersions.id,
            version: commercialCatalogVersions.version,
            approvedAt: commercialCatalogVersions.approvedAt,
          });
        if (!updated) throw new ConflictException({ code: "COMMERCIAL_DRAFT_NOT_APPROVABLE" });
        return { ...updated, status: "approved" as const };
      },
    );
  }

  async publish(
    actorIdentityId: string,
    versionId: string,
    idempotencyKey: string,
    input: CommercialPublish,
  ) {
    return this.action(
      actorIdentityId,
      idempotencyKey,
      "commercial.catalog.publish_requested",
      `${versionId}:${payloadHash(input)}`,
      input.reason,
      async (tx) => {
        await this.lockCatalog(tx);
        const [version] = await tx
          .select({
            id: commercialCatalogVersions.id,
            version: commercialCatalogVersions.version,
            status: commercialCatalogVersions.status,
          })
          .from(commercialCatalogVersions)
          .where(eq(commercialCatalogVersions.id, versionId))
          .limit(1);
        if (version?.status !== "approved")
          throw new ConflictException({ code: "COMMERCIAL_VERSION_NOT_APPROVED" });
        const now = new Date();
        const scheduled = input.publishAt && input.publishAt > now;
        if (scheduled) {
          const [other] = await tx
            .select({ id: commercialCatalogVersions.id })
            .from(commercialCatalogVersions)
            .where(eq(commercialCatalogVersions.status, "scheduled"))
            .limit(1);
          if (other)
            throw new ConflictException({ code: "COMMERCIAL_PUBLICATION_ALREADY_SCHEDULED" });
          await tx
            .update(commercialCatalogVersions)
            .set({
              status: "scheduled",
              scheduledPublishAt: input.publishAt,
              publishedByIdentityId: actorIdentityId,
              updatedAt: now,
            })
            .where(eq(commercialCatalogVersions.id, versionId));
          await tx.insert(outboxEvents).values({
            topic: "commercial.catalog_publication_scheduled",
            aggregateType: "commercial_catalog_version",
            aggregateId: versionId,
            payload: {
              catalogVersionId: versionId,
              version: version.version,
              publishAt: input.publishAt?.toISOString(),
            },
          });
          return {
            id: versionId,
            version: version.version,
            status: "scheduled" as const,
            publishAt: input.publishAt?.toISOString(),
          };
        }
        await tx
          .update(commercialCatalogVersions)
          .set({ status: "discontinued", updatedAt: now })
          .where(eq(commercialCatalogVersions.status, "published"));
        await tx
          .update(commercialCatalogVersions)
          .set({
            status: "published",
            publishedAt: now,
            scheduledPublishAt: null,
            publishedByIdentityId: actorIdentityId,
            updatedAt: now,
          })
          .where(eq(commercialCatalogVersions.id, versionId));
        await tx.insert(outboxEvents).values({
          topic: "commercial.catalog_published",
          aggregateType: "commercial_catalog_version",
          aggregateId: versionId,
          payload: { catalogVersionId: versionId, version: version.version, scheduled: false },
        });
        return {
          id: versionId,
          version: version.version,
          status: "published" as const,
          publishedAt: now.toISOString(),
        };
      },
    );
  }

  async rollback(actorIdentityId: string, idempotencyKey: string, input: CommercialRollback) {
    return this.action(
      actorIdentityId,
      idempotencyKey,
      "commercial.catalog.rolled_back",
      `${input.versionId}:${payloadHash(input)}`,
      input.reason,
      async (tx) => {
        await this.lockCatalog(tx);
        const [target] = await tx
          .select()
          .from(commercialCatalogVersions)
          .where(eq(commercialCatalogVersions.id, input.versionId))
          .limit(1);
        if (!target || !["published", "discontinued"].includes(target.status))
          throw new ConflictException({ code: "COMMERCIAL_ROLLBACK_TARGET_INVALID" });
        const [next] = await tx
          .select({
            version:
              sql<number>`coalesce(max(${commercialCatalogVersions.version}), 0)::int + 1`.mapWith(
                Number,
              ),
          })
          .from(commercialCatalogVersions);
        const now = new Date();
        await tx
          .update(commercialCatalogVersions)
          .set({ status: "discontinued", updatedAt: now })
          .where(eq(commercialCatalogVersions.status, "published"));
        const [created] = await tx
          .insert(commercialCatalogVersions)
          .values({
            version: next?.version ?? 1,
            status: "published",
            sourceVersionId: target.id,
            createdByIdentityId: actorIdentityId,
            landing: target.landing,
            seo: target.seo,
            approvedAt: now,
            approvedByIdentityId: actorIdentityId,
            publishedAt: now,
            publishedByIdentityId: actorIdentityId,
          })
          .returning({
            id: commercialCatalogVersions.id,
            version: commercialCatalogVersions.version,
          });
        if (!created) throw new Error("Commercial rollback was not created");
        await this.copyVersionRows(tx, target.id, created.id);
        await tx.insert(outboxEvents).values({
          topic: "commercial.catalog_published",
          aggregateType: "commercial_catalog_version",
          aggregateId: created.id,
          payload: {
            catalogVersionId: created.id,
            version: created.version,
            rollbackOf: target.id,
          },
        });
        return { ...created, status: "published" as const, rollbackOf: target.id };
      },
    );
  }

  async uploadMedia(actorIdentityId: string, idempotencyKey: string, input: CommercialMediaUpload) {
    const bytes = Buffer.from(input.base64, "base64");
    if (!bytes.length || bytes.length > 2_000_000)
      throw new BadRequestException({ code: "MEDIA_SIZE_INVALID" });
    const detected = detectImage(bytes);
    if (!detected || detected.mime !== input.mimeType)
      throw new BadRequestException({ code: "MEDIA_SIGNATURE_INVALID" });
    const mediaRoot = process.env.MEDIA_ROOT?.trim();
    if (!mediaRoot) throw new ServiceUnavailableException({ code: "MEDIA_STORAGE_NOT_CONFIGURED" });
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const targetFingerprint = `commercial-media:${sha256}:${payloadHash({ alt: input.alt, fileName: input.fileName })}`;
    return this.action(
      actorIdentityId,
      idempotencyKey,
      "commercial.media.uploaded",
      targetFingerprint,
      input.reason,
      async (tx) => {
        const [duplicate] = await tx
          .select({
            id: commercialMediaAssets.id,
            key: commercialMediaAssets.key,
            url: commercialMediaAssets.url,
            alt: commercialMediaAssets.alt,
          })
          .from(commercialMediaAssets)
          .where(
            and(
              eq(commercialMediaAssets.sha256, sha256),
              eq(commercialMediaAssets.alt, input.alt),
              isNull(commercialMediaAssets.deletedAt),
            ),
          )
          .limit(1);
        if (duplicate) return duplicate;
        const key = `${randomBytes(16).toString("hex")}.${detected.extension}`;
        const root = resolve(mediaRoot);
        await mkdir(root, { recursive: true });
        const target = resolve(root, key);
        const temporary = `${target}.${randomBytes(8).toString("hex")}.tmp`;
        try {
          await writeFile(temporary, bytes, { flag: "wx" });
          await rename(temporary, target);
          const apiUrl = new URL(process.env.API_URL ?? "http://localhost:3200");
          const url = new URL(`/public/v1/media/${key}`, apiUrl).toString();
          const [asset] = await tx
            .insert(commercialMediaAssets)
            .values({
              key,
              url,
              fileName: input.fileName,
              mimeType: input.mimeType,
              sizeBytes: bytes.length,
              sha256,
              alt: input.alt,
              createdByIdentityId: actorIdentityId,
            })
            .returning({
              id: commercialMediaAssets.id,
              key: commercialMediaAssets.key,
              url: commercialMediaAssets.url,
              alt: commercialMediaAssets.alt,
            });
          if (!asset) throw new Error("Commercial media was not persisted");
          return asset;
        } catch (error) {
          await unlink(temporary).catch(() => undefined);
          await unlink(target).catch(() => undefined);
          throw error;
        }
      },
    );
  }

  async deleteMedia(actorIdentityId: string, mediaId: string, reason: string) {
    const [asset] = await this.database.db
      .select()
      .from(commercialMediaAssets)
      .where(eq(commercialMediaAssets.id, mediaId))
      .limit(1);
    if (!asset) throw new NotFoundException({ code: "COMMERCIAL_MEDIA_NOT_FOUND" });
    if (asset.deletedAt) return { id: mediaId, deleted: true, replayed: true };
    const references = await this.database.db
      .select({ id: commercialCatalogVersions.id })
      .from(commercialCatalogVersions)
      .where(
        or(
          sql`${commercialCatalogVersions.landing}::text like ${`%${mediaId}%`}`,
          sql`${commercialCatalogVersions.seo}::text like ${`%${mediaId}%`}`,
        ),
      )
      .limit(1);
    if (references.length) throw new ConflictException({ code: "COMMERCIAL_MEDIA_IN_USE" });
    await this.database.db.transaction(async (tx) => {
      await tx
        .update(commercialMediaAssets)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(commercialMediaAssets.id, mediaId));
      await tx.insert(auditEvents).values({
        actorIdentityId,
        action: "commercial.media.deleted",
        entityType: "commercial_media",
        entityId: mediaId,
        metadata: { reason, key: asset.key },
      });
    });
    const configuredRoot = process.env.MEDIA_ROOT?.trim();
    if (configuredRoot && /^[a-f0-9]{32}\.(?:jpg|png|webp)$/.test(asset.key)) {
      const root = resolve(configuredRoot);
      const target = resolve(root, asset.key);
      if (target.startsWith(`${root}${sep}`)) await unlink(target).catch(() => undefined);
    }
    return { id: mediaId, deleted: true, replayed: false };
  }

  async createCampaign(
    actorIdentityId: string,
    idempotencyKey: string,
    input: CommercialCampaignInput,
  ) {
    return this.action(
      actorIdentityId,
      idempotencyKey,
      "commercial.campaign.created",
      `new:${payloadHash(input)}`,
      input.reason,
      async (tx) => {
        const { reason: _reason, ...values } = input;
        const [campaign] = await tx
          .insert(commercialCampaigns)
          .values({ ...values, startsAt: values.startsAt ?? null, endsAt: values.endsAt ?? null })
          .returning();
        if (!campaign) throw new Error("Commercial campaign was not created");
        return campaign;
      },
    );
  }

  async updateCampaign(
    actorIdentityId: string,
    campaignId: string,
    idempotencyKey: string,
    input: CommercialCampaignInput,
  ) {
    return this.action(
      actorIdentityId,
      idempotencyKey,
      "commercial.campaign.updated",
      `${campaignId}:${payloadHash(input)}`,
      input.reason,
      async (tx) => {
        const { reason: _reason, ...values } = input;
        const [campaign] = await tx
          .update(commercialCampaigns)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(commercialCampaigns.id, campaignId))
          .returning();
        if (!campaign) throw new NotFoundException({ code: "COMMERCIAL_CAMPAIGN_NOT_FOUND" });
        return campaign;
      },
    );
  }

  async leads(query: CommercialLeadQuery) {
    const pattern = `%${query.search}%`;
    const campaignCondition = query.campaignSlug
      ? eq(trialApplications.campaignSlug, query.campaignSlug)
      : undefined;
    const contactCampaignCondition = query.campaignSlug
      ? eq(contactRequests.campaignSlug, query.campaignSlug)
      : undefined;
    const [trials, contacts] = await Promise.all([
      query.type === "contact"
        ? Promise.resolve([])
        : this.database.db
            .select()
            .from(trialApplications)
            .where(
              and(
                campaignCondition,
                query.search
                  ? or(
                      ilike(trialApplications.name, pattern),
                      ilike(trialApplications.email, pattern),
                      ilike(trialApplications.businessName, pattern),
                    )
                  : undefined,
              ),
            )
            .orderBy(desc(trialApplications.createdAt))
            .limit(500),
      query.type === "trial"
        ? Promise.resolve([])
        : this.database.db
            .select()
            .from(contactRequests)
            .where(
              and(
                contactCampaignCondition,
                query.search
                  ? or(ilike(contactRequests.name, pattern), ilike(contactRequests.email, pattern))
                  : undefined,
              ),
            )
            .orderBy(desc(contactRequests.createdAt))
            .limit(500),
    ]);
    const states = await this.database.db.select().from(commercialLeadStates);
    const stateBySource = new Map(
      states.map((state) => [`${state.sourceType}:${state.sourceId}`, state] as const),
    );
    const all = [
      ...trials.map((lead) => ({ ...lead, type: "trial" as const })),
      ...contacts.map(({ message, ...lead }) => ({
        ...lead,
        type: "contact" as const,
        messageAvailable: Boolean(message),
      })),
    ]
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map((lead) => ({
        ...lead,
        name: maskName(lead.name),
        email: maskEmail(lead.email),
        phone: maskPhone(lead.phone),
        state: stateBySource.get(`${lead.type}:${lead.id}`) ?? {
          stage: "new" as const,
          assignedToIdentityId: null,
          organizationId: null,
          notes: null,
          lastContactAt: null,
        },
      }))
      .filter((lead) => !query.stage || lead.state.stage === query.stage)
      .filter(
        (lead) =>
          !query.assignedToIdentityId ||
          lead.state.assignedToIdentityId === query.assignedToIdentityId,
      );
    const offset = (query.cursor - 1) * query.limit;
    return {
      items: all.slice(offset, offset + query.limit),
      total: all.length,
      nextCursor: offset + query.limit < all.length ? String(query.cursor + 1) : null,
    };
  }

  async updateLeadState(
    actorIdentityId: string,
    sourceType: "trial" | "contact",
    sourceId: string,
    idempotencyKey: string,
    input: CommercialLeadStateInput,
  ) {
    return this.action(
      actorIdentityId,
      idempotencyKey,
      "commercial.lead.state_updated",
      `${sourceType}:${sourceId}:${payloadHash(input)}`,
      input.reason,
      async (tx) => {
        const sourceTable = sourceType === "trial" ? trialApplications : contactRequests;
        const [source] = await tx
          .select({ id: sourceTable.id })
          .from(sourceTable)
          .where(eq(sourceTable.id, sourceId))
          .limit(1);
        if (!source) throw new NotFoundException({ code: "COMMERCIAL_LEAD_NOT_FOUND" });
        const now = new Date();
        const [state] = await tx
          .insert(commercialLeadStates)
          .values({
            sourceType,
            sourceId,
            stage: input.stage,
            assignedToIdentityId: input.assignedToIdentityId ?? null,
            organizationId: input.organizationId ?? null,
            notes: input.notes ?? null,
            lastContactAt: input.lastContactAt ?? null,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [commercialLeadStates.sourceType, commercialLeadStates.sourceId],
            set: {
              stage: input.stage,
              assignedToIdentityId: input.assignedToIdentityId ?? null,
              organizationId: input.organizationId ?? null,
              notes: input.notes ?? null,
              lastContactAt: input.lastContactAt ?? null,
              updatedAt: now,
            },
          })
          .returning();
        if (!state) throw new Error("Commercial lead state was not persisted");
        return state;
      },
    );
  }

  async metrics() {
    const [
      trialCounts,
      contactCounts,
      promotionCounts,
      checkoutCounts,
      leadStateCounts,
      trialExperimentCounts,
      contactExperimentCounts,
      impressionCounts,
    ] = await Promise.all([
      this.database.db
        .select({
          campaignSlug: trialApplications.campaignSlug,
          count: sql<number>`count(*)::int`.mapWith(Number),
        })
        .from(trialApplications)
        .groupBy(trialApplications.campaignSlug),
      this.database.db
        .select({
          campaignSlug: contactRequests.campaignSlug,
          count: sql<number>`count(*)::int`.mapWith(Number),
        })
        .from(contactRequests)
        .groupBy(contactRequests.campaignSlug),
      this.database.db
        .select({
          promotionId: billingCheckouts.promotionId,
          count: sql<number>`count(*)::int`.mapWith(Number),
          revenueCents:
            sql<number>`coalesce(sum(${billingCheckouts.amountCents}), 0)::bigint`.mapWith(Number),
        })
        .from(billingCheckouts)
        .where(and(ne(billingCheckouts.status, "failed"), ne(billingCheckouts.status, "canceled")))
        .groupBy(billingCheckouts.promotionId),
      this.database.db
        .select({
          status: billingCheckouts.status,
          count: sql<number>`count(*)::int`.mapWith(Number),
        })
        .from(billingCheckouts)
        .groupBy(billingCheckouts.status),
      this.database.db
        .select({
          stage: commercialLeadStates.stage,
          linkedOrganizations:
            sql<number>`count(${commercialLeadStates.organizationId})::int`.mapWith(Number),
          count: sql<number>`count(*)::int`.mapWith(Number),
        })
        .from(commercialLeadStates)
        .groupBy(commercialLeadStates.stage),
      this.database.db
        .select({
          experimentSlug: trialApplications.experimentSlug,
          variantKey: trialApplications.experimentVariantKey,
          leads: sql<number>`count(*)::int`.mapWith(Number),
        })
        .from(trialApplications)
        .where(isNotNull(trialApplications.experimentSlug))
        .groupBy(trialApplications.experimentSlug, trialApplications.experimentVariantKey),
      this.database.db
        .select({
          experimentSlug: contactRequests.experimentSlug,
          variantKey: contactRequests.experimentVariantKey,
          leads: sql<number>`count(*)::int`.mapWith(Number),
        })
        .from(contactRequests)
        .where(isNotNull(contactRequests.experimentSlug))
        .groupBy(contactRequests.experimentSlug, contactRequests.experimentVariantKey),
      this.database.db
        .select({
          experimentSlug: commercialExperimentImpressions.experimentSlug,
          variantKey: commercialExperimentImpressions.variantKey,
          impressions: sql<number>`count(*)::int`.mapWith(Number),
        })
        .from(commercialExperimentImpressions)
        .groupBy(
          commercialExperimentImpressions.experimentSlug,
          commercialExperimentImpressions.variantKey,
        ),
    ]);
    return {
      leads: {
        trials: trialCounts.reduce((total, row) => total + row.count, 0),
        contacts: contactCounts.reduce((total, row) => total + row.count, 0),
        byCampaign: mergeCampaignCounts(trialCounts, contactCounts),
      },
      checkouts: Object.fromEntries(checkoutCounts.map((row) => [row.status, row.count])),
      promotions: promotionCounts,
      funnel: {
        status: leadStateCounts.length ? "ok" : "partial",
        reason: leadStateCounts.length ? null : "LEAD_STATE_NOT_LINKED",
        stages: Object.fromEntries(leadStateCounts.map((row) => [row.stage, row.count])),
        convertedOrganizations: leadStateCounts
          .filter((row) => row.stage === "converted")
          .reduce((total, row) => total + row.linkedOrganizations, 0),
      },
      experiments: {
        impressionsAvailable: true,
        impressions: impressionCounts,
        leads: mergeExperimentCounts(trialExperimentCounts, contactExperimentCounts),
      },
    };
  }

  private async action<T extends Record<string, unknown>>(
    actorIdentityId: string,
    idempotencyKey: string,
    action: string,
    targetId: string,
    reason: string,
    perform: (tx: Transaction) => Promise<T>,
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
        if (receipt.action !== action || receipt.targetId !== targetId)
          throw new ConflictException({ code: "PLATFORM_IDEMPOTENCY_KEY_REUSED" });
        return { ...receipt.result, replayed: true };
      }
      const result = await perform(tx);
      await tx.insert(auditEvents).values({
        actorIdentityId,
        action,
        entityType: action.startsWith("commercial.campaign")
          ? "commercial_campaign"
          : "commercial_catalog",
        entityId: "id" in result && typeof result.id === "string" ? result.id : targetId,
        metadata: { reason, idempotencyKey },
      });
      await tx.insert(platformActionReceipts).values({
        actorIdentityId,
        idempotencyKey,
        action,
        targetType: "commercial",
        targetId,
        reason,
        result,
      });
      return { ...result, replayed: false };
    });
  }

  private lockCatalog(tx: Transaction) {
    return tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('commercial-catalog', 0))`);
  }

  private async copyVersionRows(tx: Transaction, sourceId: string, targetId: string) {
    const [plans, promotions, experiments] = await Promise.all([
      tx.select().from(commercialPlans).where(eq(commercialPlans.catalogVersionId, sourceId)),
      tx
        .select()
        .from(commercialPromotions)
        .where(eq(commercialPromotions.catalogVersionId, sourceId)),
      tx
        .select()
        .from(commercialExperiments)
        .where(eq(commercialExperiments.catalogVersionId, sourceId)),
    ]);
    if (plans.length)
      await tx.insert(commercialPlans).values(
        plans.map(({ id: _id, ...plan }) => ({
          ...plan,
          catalogVersionId: targetId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      );
    if (promotions.length)
      await tx.insert(commercialPromotions).values(
        promotions.map(({ id: _id, ...promotion }) => ({
          ...promotion,
          catalogVersionId: targetId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      );
    if (experiments.length)
      await tx.insert(commercialExperiments).values(
        experiments.map(({ id: _id, ...experiment }) => ({
          ...experiment,
          catalogVersionId: targetId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      );
  }

  private async assertMediaReferences(
    tx: Transaction,
    landing: { hero: { mediaId?: string } },
    seo: { ogMediaId?: string },
  ) {
    const ids = [landing.hero.mediaId, seo.ogMediaId].filter((id): id is string => Boolean(id));
    if (!ids.length) return;
    const rows = await tx
      .select({ id: commercialMediaAssets.id })
      .from(commercialMediaAssets)
      .where(and(inArray(commercialMediaAssets.id, ids), isNull(commercialMediaAssets.deletedAt)));
    if (new Set(rows.map((row) => row.id)).size !== new Set(ids).size)
      throw new BadRequestException({ code: "COMMERCIAL_MEDIA_REFERENCE_INVALID" });
  }
}

function detectImage(bytes: Buffer) {
  return [
    {
      extension: "jpg",
      mime: "image/jpeg",
      matches: bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    },
    {
      extension: "png",
      mime: "image/png",
      matches: bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    },
    {
      extension: "webp",
      mime: "image/webp",
      matches:
        bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
        bytes.subarray(8, 12).toString("ascii") === "WEBP",
    },
  ].find((candidate) => candidate.matches);
}

function payloadHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function mergeCampaignCounts(
  trials: Array<{ campaignSlug: string | null; count: number }>,
  contacts: Array<{ campaignSlug: string | null; count: number }>,
) {
  const merged = new Map<
    string,
    { campaignSlug: string | null; trials: number; contacts: number }
  >();
  for (const row of trials)
    merged.set(row.campaignSlug ?? "unattributed", {
      campaignSlug: row.campaignSlug,
      trials: row.count,
      contacts: 0,
    });
  for (const row of contacts) {
    const key = row.campaignSlug ?? "unattributed";
    const current = merged.get(key) ?? { campaignSlug: row.campaignSlug, trials: 0, contacts: 0 };
    current.contacts += row.count;
    merged.set(key, current);
  }
  return [...merged.values()];
}

function mergeExperimentCounts(
  trials: Array<{ experimentSlug: string | null; variantKey: string | null; leads: number }>,
  contacts: Array<{ experimentSlug: string | null; variantKey: string | null; leads: number }>,
) {
  const merged = new Map<
    string,
    { experimentSlug: string; variantKey: string; trials: number; contacts: number }
  >();
  for (const [type, rows] of [
    ["trials", trials],
    ["contacts", contacts],
  ] as const) {
    for (const row of rows) {
      if (!row.experimentSlug || !row.variantKey) continue;
      const key = `${row.experimentSlug}:${row.variantKey}`;
      const current = merged.get(key) ?? {
        experimentSlug: row.experimentSlug,
        variantKey: row.variantKey,
        trials: 0,
        contacts: 0,
      };
      current[type] += row.leads;
      merged.set(key, current);
    }
  }
  return [...merged.values()];
}
