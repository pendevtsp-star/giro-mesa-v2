import { randomBytes } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  CreateTableQrPrintBatchInput,
  TableQrSettings,
  TestTableQrUrlInput,
  UpdateTableQrSettingsInput,
} from "@giromesa/contracts";
import {
  auditEvents,
  type Database,
  identities,
  organizations,
  outboxEvents,
  posAllergens,
  posCatalogBranding,
  posCatalogCategories,
  posCatalogPromotions,
  posCategoryUnitConfigs,
  posComboItems,
  posCombos,
  posDiningTables,
  posIdempotencyReceipts,
  posKdsTerminalProfiles,
  posKdsTickets,
  posModifierGroups,
  posModifierOptions,
  posOrderItems,
  posProductAllergens,
  posProductAvailability,
  posProductionStations,
  posProductModifierGroups,
  posProductPrices,
  posProductStations,
  posProducts,
  posRecipeComponents,
  posTableQrMetrics,
  posTableQrPrintBatches,
  posTableQrSettings,
  publicMenus,
  units,
} from "@giromesa/db";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { tablePresenceCode } from "../common/table-presence-code.js";
import { DatabaseService } from "../database/database.module.js";
import {
  EstablishmentSettingsService,
  normalizeStoredBranding,
  projectPublicBranding,
} from "../organizations/establishment-settings.service.js";
import { ScopeService } from "../organizations/scope.service.js";
import {
  createTableAccessToken,
  tableAccessSecret,
  verifyTableAccessToken,
} from "../public-menu/table-access-token.js";
import { MAX_STORED_CENTS, replayResult, requestHash } from "./pilot-rules.js";
import type {
  AggregateProductInput,
  AllergenInput,
  AnalyticsQueryInput,
  BrandingInput,
  BulkPriceInput,
  CategoryAvailabilityInput,
  CategoryInput,
  ComboInput,
  DailyStockInput,
  ImportCatalogInput,
  MediaUploadInput,
  ModifierGroupInput,
  ModifierOptionInput,
  ProductInput,
  ProductUnitConfigInput,
  PromotionInput,
  PublicationInput,
  ReorderInput,
  StationInput,
  UpdateAllergenInput,
  UpdateCategoryInput,
  UpdateModifierGroupInput,
  UpdateModifierOptionInput,
  UpdateProductInput,
  UpdatePromotionInput,
  UpdateStationInput,
} from "./pilot-schemas.js";
import { promotionSchema } from "./pilot-schemas.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type TableQrSettingsRow = typeof posTableQrSettings.$inferSelect;
type TableQrPrintBatchRow = typeof posTableQrPrintBatches.$inferSelect;

const tableQrUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class PilotCatalogService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
    private readonly establishmentSettings: EstablishmentSettingsService = new EstablishmentSettingsService(
      database,
      scope,
    ),
  ) {}

  private async requireAccess(identityId: string, organizationId: string, unitId: string) {
    return this.scope.requireUnitAccess(identityId, organizationId, unitId);
  }

  private async requireManager(identityId: string, organizationId: string, unitId: string) {
    await this.requireAccess(identityId, organizationId, unitId);
    const roles = await this.scope.requireOrganizationRole(identityId, organizationId, [
      "owner",
      "manager",
    ]);
    if (!roles.some((role) => role.unitId === null || role.unitId === unitId)) {
      throw new ForbiddenException({
        code: "CATALOG_SCOPE_DENIED",
        message: "Gestão de catálogo não autorizada nesta unidade.",
      });
    }
  }

  private async unitBusinessDate(organizationId: string, unitId: string) {
    const [unit] = await this.database.db
      .select({ timezone: units.timezone })
      .from(units)
      .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
      .limit(1);
    if (!unit) throw new NotFoundException({ code: "UNIT_NOT_FOUND" });
    return new Intl.DateTimeFormat("en-CA", { timeZone: unit.timezone }).format(new Date());
  }

  private async idempotentCreate<T extends Record<string, unknown>>(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    operation: string,
    resourceType: string,
    payload: unknown,
    work: (tx: Transaction) => Promise<T>,
  ) {
    if (!idempotencyKey || idempotencyKey.trim().length < 8 || idempotencyKey.length > 160) {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Envie Idempotency-Key com 8 a 160 caracteres.",
      });
    }
    const normalizedKey = idempotencyKey.trim();
    const hash = requestHash(operation, {
      resource: { organizationId, unitId, type: resourceType },
      actorIdentityId: identityId,
      payload,
    });
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`pos-idem:${organizationId}:${unitId}:${normalizedKey}`}))`,
      );
      const [existing] = await tx
        .select({
          actorIdentityId: posIdempotencyReceipts.actorIdentityId,
          operation: posIdempotencyReceipts.operation,
          requestHash: posIdempotencyReceipts.requestHash,
          response: posIdempotencyReceipts.response,
        })
        .from(posIdempotencyReceipts)
        .where(
          and(
            eq(posIdempotencyReceipts.organizationId, organizationId),
            eq(posIdempotencyReceipts.unitId, unitId),
            eq(posIdempotencyReceipts.key, normalizedKey),
          ),
        )
        .limit(1);
      const replay = replayResult<T>(existing, operation, hash, identityId);
      if (replay) return replay;

      const response = await work(tx);
      const stored = JSON.parse(JSON.stringify(response)) as T;
      await tx.insert(posIdempotencyReceipts).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        key: normalizedKey,
        operation,
        requestHash: hash,
        response: stored,
      });
      return { ...stored, idempotentReplay: false };
    });
  }

  async list(identityId: string, organizationId: string, unitId: string) {
    await this.requireAccess(identityId, organizationId, unitId);
    const businessDate = await this.unitBusinessDate(organizationId, unitId);
    const [
      categories,
      allergens,
      modifierGroups,
      modifierOptions,
      products,
      recipes,
      productAllergens,
      productModifierGroups,
      prices,
      availability,
      stations,
      productStations,
      combos,
      comboItems,
      categoryUnitConfigs,
      promotions,
      branding,
      publication,
    ] = await Promise.all([
      this.database.db
        .select()
        .from(posCatalogCategories)
        .where(eq(posCatalogCategories.organizationId, organizationId)),
      this.database.db
        .select()
        .from(posAllergens)
        .where(eq(posAllergens.organizationId, organizationId)),
      this.database.db
        .select()
        .from(posModifierGroups)
        .where(eq(posModifierGroups.organizationId, organizationId)),
      this.database.db
        .select()
        .from(posModifierOptions)
        .where(eq(posModifierOptions.organizationId, organizationId)),
      this.database.db
        .select()
        .from(posProducts)
        .where(eq(posProducts.organizationId, organizationId)),
      this.database.db
        .select()
        .from(posRecipeComponents)
        .where(eq(posRecipeComponents.organizationId, organizationId)),
      this.database.db
        .select()
        .from(posProductAllergens)
        .where(eq(posProductAllergens.organizationId, organizationId)),
      this.database.db
        .select()
        .from(posProductModifierGroups)
        .where(eq(posProductModifierGroups.organizationId, organizationId)),
      this.database.db
        .select()
        .from(posProductPrices)
        .where(
          and(
            eq(posProductPrices.organizationId, organizationId),
            eq(posProductPrices.unitId, unitId),
          ),
        ),
      this.database.db
        .select()
        .from(posProductAvailability)
        .where(
          and(
            eq(posProductAvailability.organizationId, organizationId),
            eq(posProductAvailability.unitId, unitId),
          ),
        ),
      this.database.db
        .select()
        .from(posProductionStations)
        .where(
          and(
            eq(posProductionStations.organizationId, organizationId),
            eq(posProductionStations.unitId, unitId),
          ),
        ),
      this.database.db
        .select()
        .from(posProductStations)
        .where(
          and(
            eq(posProductStations.organizationId, organizationId),
            eq(posProductStations.unitId, unitId),
          ),
        ),
      this.database.db.select().from(posCombos).where(eq(posCombos.organizationId, organizationId)),
      this.database.db
        .select()
        .from(posComboItems)
        .where(eq(posComboItems.organizationId, organizationId)),
      this.database.db
        .select()
        .from(posCategoryUnitConfigs)
        .where(
          and(
            eq(posCategoryUnitConfigs.organizationId, organizationId),
            eq(posCategoryUnitConfigs.unitId, unitId),
          ),
        ),
      this.database.db
        .select()
        .from(posCatalogPromotions)
        .where(
          and(
            eq(posCatalogPromotions.organizationId, organizationId),
            eq(posCatalogPromotions.unitId, unitId),
          ),
        ),
      this.database.db
        .select()
        .from(posCatalogBranding)
        .where(
          and(
            eq(posCatalogBranding.organizationId, organizationId),
            eq(posCatalogBranding.unitId, unitId),
          ),
        ),
      this.database.db
        .select()
        .from(publicMenus)
        .where(and(eq(publicMenus.organizationId, organizationId), eq(publicMenus.unitId, unitId))),
    ]);
    return {
      categories,
      allergens,
      modifierGroups,
      modifierOptions,
      products,
      recipes,
      productAllergens,
      productModifierGroups,
      prices,
      availability: availability.map((row) => ({
        ...row,
        dailyStockRemaining:
          row.dailyStock === null
            ? null
            : Math.max(0, row.dailyStock - (row.stockDate === businessDate ? row.soldToday : 0)),
      })),
      stations,
      productStations,
      combos,
      comboItems,
      categoryUnitConfigs,
      promotions,
      branding: branding[0]?.config ?? null,
      publication: publication[0] ?? null,
    };
  }

  async createCategory(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: CategoryInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    return this.idempotentCreate(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "catalog.category.create",
      "category",
      input,
      async (tx) => {
        const [category] = await tx
          .insert(posCatalogCategories)
          .values({ organizationId, ...input })
          .returning();
        if (!category) throw new Error("Category insert did not return a row");
        await this.recordChange(
          tx,
          identityId,
          organizationId,
          unitId,
          "pos.category.created",
          "category",
          category.id,
          {},
        );
        return category;
      },
    );
  }

  async updateCategory(
    identityId: string,
    organizationId: string,
    unitId: string,
    categoryId: string,
    input: UpdateCategoryInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    return this.database.db.transaction(async (tx) => {
      const [category] = await tx
        .select({ id: posCatalogCategories.id })
        .from(posCatalogCategories)
        .where(
          and(
            eq(posCatalogCategories.organizationId, organizationId),
            eq(posCatalogCategories.id, categoryId),
          ),
        )
        .limit(1);
      if (!category) throw new NotFoundException({ code: "CATEGORY_NOT_FOUND" });
      if (Object.values(input).some((value) => value !== undefined)) {
        await tx
          .update(posCatalogCategories)
          .set({
            name: input.name,
            description: input.description,
            sortOrder: input.sortOrder,
            active: input.active,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(posCatalogCategories.organizationId, organizationId),
              eq(posCatalogCategories.id, categoryId),
            ),
          );
        await tx.insert(auditEvents).values({
          organizationId,
          unitId,
          actorIdentityId: identityId,
          action: "pos.category.updated",
          entityType: "category",
          entityId: categoryId,
          metadata: input,
        });
        await tx.insert(outboxEvents).values({
          topic: "pos.catalog_changed",
          aggregateType: "category",
          aggregateId: categoryId,
          payload: { organizationId, unitId, categoryId, action: "updated" },
        });
        if (
          input.channels !== undefined ||
          input.schedule !== undefined ||
          input.defaultStationId !== undefined
        ) {
          if (input.defaultStationId) {
            await this.assertStations(organizationId, unitId, [input.defaultStationId]);
          }
          await tx
            .insert(posCategoryUnitConfigs)
            .values({
              organizationId,
              unitId,
              categoryId,
              channels: input.channels,
              schedule: input.schedule,
              defaultStationId: input.defaultStationId,
            })
            .onConflictDoUpdate({
              target: [posCategoryUnitConfigs.unitId, posCategoryUnitConfigs.categoryId],
              set: {
                channels: input.channels,
                schedule: input.schedule,
                defaultStationId: input.defaultStationId,
                updatedAt: new Date(),
              },
            });
        }
      }
      return { id: categoryId };
    });
  }

  async archiveCategory(
    identityId: string,
    organizationId: string,
    unitId: string,
    categoryId: string,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    return this.database.db.transaction(async (tx) => {
      const [category] = await tx
        .select({ id: posCatalogCategories.id })
        .from(posCatalogCategories)
        .where(
          and(
            eq(posCatalogCategories.organizationId, organizationId),
            eq(posCatalogCategories.id, categoryId),
          ),
        )
        .limit(1);
      if (!category) throw new NotFoundException({ code: "CATEGORY_NOT_FOUND" });
      const [activeProduct] = await tx
        .select({ id: posProducts.id })
        .from(posProducts)
        .where(
          and(
            eq(posProducts.organizationId, organizationId),
            eq(posProducts.categoryId, categoryId),
            eq(posProducts.active, true),
          ),
        )
        .limit(1);
      if (activeProduct) {
        throw new ForbiddenException({
          code: "CATEGORY_HAS_ACTIVE_PRODUCTS",
          message: "A categoria não pode ser arquivada pois possui produtos ativos.",
        });
      }
      await tx
        .update(posCatalogCategories)
        .set({ active: false, updatedAt: new Date() })
        .where(
          and(
            eq(posCatalogCategories.organizationId, organizationId),
            eq(posCatalogCategories.id, categoryId),
          ),
        );
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "pos.category.archived",
        entityType: "category",
        entityId: categoryId,
        metadata: {},
      });
      await tx.insert(outboxEvents).values({
        topic: "pos.catalog_changed",
        aggregateType: "category",
        aggregateId: categoryId,
        payload: { organizationId, unitId, categoryId, action: "archived" },
      });
      return { id: categoryId };
    });
  }

  async createAllergen(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: AllergenInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    return this.idempotentCreate(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "catalog.allergen.create",
      "allergen",
      input,
      async (tx) => {
        const [allergen] = await tx
          .insert(posAllergens)
          .values({ organizationId, ...input })
          .returning();
        if (!allergen) throw new Error("Allergen insert did not return a row");
        await this.recordChange(
          tx,
          identityId,
          organizationId,
          unitId,
          "pos.allergen.created",
          "allergen",
          allergen.id,
          {},
        );
        return allergen;
      },
    );
  }

  async createModifierGroup(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: ModifierGroupInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    return this.idempotentCreate(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "catalog.modifier_group.create",
      "modifier_group",
      input,
      async (tx) => {
        const [group] = await tx
          .insert(posModifierGroups)
          .values({
            organizationId,
            name: input.name,
            minimumSelections: input.minimumSelections,
            maximumSelections: input.maximumSelections,
          })
          .returning();
        if (!group) throw new Error("Modifier group insert did not return a row");
        const options = input.options.length
          ? await tx
              .insert(posModifierOptions)
              .values(
                input.options.map((option) => ({ organizationId, groupId: group.id, ...option })),
              )
              .returning()
          : [];
        await this.recordChange(
          tx,
          identityId,
          organizationId,
          unitId,
          "pos.modifier_group.created",
          "modifier_group",
          group.id,
          {},
        );
        return { ...group, options };
      },
    );
  }

  async createStation(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: StationInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    return this.idempotentCreate(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "catalog.station.create",
      "production_station",
      input,
      async (tx) => {
        const [station] = await tx
          .insert(posProductionStations)
          .values({ organizationId, unitId, ...input })
          .returning();
        if (!station) throw new Error("Production station insert did not return a row");
        await this.recordChange(
          tx,
          identityId,
          organizationId,
          unitId,
          "pos.station.created",
          "production_station",
          station.id,
          {},
        );
        return station;
      },
    );
  }

  async createProduct(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: ProductInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    const stockDate = await this.unitBusinessDate(organizationId, unitId);
    return this.idempotentCreate(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "catalog.product.create",
      "product",
      input,
      async (tx) => {
        await this.assertProductReferences(organizationId, unitId, input);
        const [product] = await tx
          .insert(posProducts)
          .values({
            organizationId,
            categoryId: input.categoryId,
            imageUrl: input.imageUrl,
            sku: input.sku,
            ean: input.ean,
            productType: input.productType ?? "prepared",
            sortOrder: input.sortOrder ?? 0,
            name: input.name,
            description: input.description,
            estimatedPrepTimeMinutes: input.estimatedPrepTimeMinutes,
            metadata: {
              tags: input.tags ?? [],
              dietaryFlags: input.dietaryFlags ?? [],
              spiciness: input.spiciness ?? null,
              pairing: input.pairing ?? null,
              suggestedProductIds: input.suggestedProductIds ?? [],
              sizes: input.sizes ?? [],
              translations: input.translations ?? {},
              fiscal: input.fiscal ?? {},
            },
          })
          .returning();
        if (!product) throw new Error("Product insert did not return a row");
        if (input.allergenIds.length > 0) {
          await tx.insert(posProductAllergens).values(
            [...new Set(input.allergenIds)].map((allergenId) => ({
              organizationId,
              productId: product.id,
              allergenId,
            })),
          );
        }
        if (input.modifierGroupIds.length > 0) {
          await tx.insert(posProductModifierGroups).values(
            [...new Set(input.modifierGroupIds)].map((groupId, sortOrder) => ({
              organizationId,
              productId: product.id,
              groupId,
              sortOrder,
            })),
          );
        }
        if (input.recipe.length > 0) {
          await tx.insert(posRecipeComponents).values(
            input.recipe.map((component) => ({
              organizationId,
              productId: product.id,
              ...component,
            })),
          );
        }
        await tx.insert(posProductPrices).values({
          organizationId,
          unitId,
          productId: product.id,
          priceCents: input.priceCents,
          deliveryPriceCents: input.deliveryPriceCents,
          costCents: input.costCents,
        });
        await tx.insert(posProductAvailability).values({
          organizationId,
          unitId,
          productId: product.id,
          available: input.available,
          schedule: input.availabilitySchedule,
          dailyStock: input.dailyStock,
          stockDate,
          autoDeductStock: input.autoDeductStock ?? false,
        });
        await this.lockAndAssertStations(tx, organizationId, unitId, input.stationIds);
        await tx.insert(posProductStations).values(
          [...new Set(input.stationIds)].map((stationId) => ({
            organizationId,
            unitId,
            productId: product.id,
            stationId,
            stage: input.stationRouting?.find((route) => route.stationId === stationId)?.stage ?? 1,
          })),
        );
        await tx.insert(auditEvents).values({
          organizationId,
          unitId,
          actorIdentityId: identityId,
          action: "pos.product.created",
          entityType: "product",
          entityId: product.id,
          metadata: { priceCents: input.priceCents },
        });
        await tx.insert(outboxEvents).values({
          topic: "pos.catalog_changed",
          aggregateType: "product",
          aggregateId: product.id,
          payload: { organizationId, unitId, productId: product.id, action: "created" },
        });
        return product;
      },
    );
  }

  async createCombo(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: ComboInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    return this.idempotentCreate(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "catalog.combo.create",
      "combo",
      input,
      async (tx) => {
        const productIds = input.items.map((item) => item.productId);
        const products = await tx
          .select({ id: posProducts.id })
          .from(posProducts)
          .where(
            and(
              eq(posProducts.organizationId, organizationId),
              eq(posProducts.active, true),
              inArray(posProducts.id, productIds),
            ),
          );
        if (products.length !== productIds.length) {
          throw new NotFoundException({ code: "COMBO_PRODUCT_NOT_FOUND" });
        }
        const [combo] = await tx
          .insert(posCombos)
          .values({
            organizationId,
            name: input.name,
            description: input.description,
            imageUrl: input.imageUrl,
            priceCents: input.priceCents,
            active: input.active,
          })
          .returning();

        if (!combo) throw new Error("Combo insert did not return a row");

        if (input.items.length > 0) {
          await tx.insert(posComboItems).values(
            input.items.map((item) => ({
              organizationId,
              comboId: combo.id,
              productId: item.productId,
              quantity: item.quantity,
            })),
          );
        }

        await tx.insert(auditEvents).values({
          organizationId,
          unitId,
          actorIdentityId: identityId,
          action: "pos.combo.created",
          entityType: "combo",
          entityId: combo.id,
          metadata: { name: input.name, priceCents: input.priceCents },
        });
        await tx.insert(outboxEvents).values({
          topic: "pos.catalog_changed",
          aggregateType: "combo",
          aggregateId: combo.id,
          payload: { organizationId, unitId, comboId: combo.id, action: "created" },
        });
        return combo;
      },
    );
  }

  async updateProduct(
    identityId: string,
    organizationId: string,
    unitId: string,
    productId: string,
    input: UpdateProductInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    return this.database.db.transaction(async (tx) => {
      const [product] = await tx
        .select({ id: posProducts.id })
        .from(posProducts)
        .where(and(eq(posProducts.organizationId, organizationId), eq(posProducts.id, productId)))
        .limit(1);
      if (!product) throw new NotFoundException({ code: "PRODUCT_NOT_FOUND" });
      if (input.categoryId !== undefined) {
        const [category] = await tx
          .select({ id: posCatalogCategories.id })
          .from(posCatalogCategories)
          .where(
            and(
              eq(posCatalogCategories.organizationId, organizationId),
              eq(posCatalogCategories.id, input.categoryId),
              eq(posCatalogCategories.active, true),
            ),
          )
          .limit(1);
        if (!category) throw new NotFoundException({ code: "CATEGORY_NOT_FOUND" });
      }
      if (Object.values(input).some((value) => value !== undefined)) {
        await tx
          .update(posProducts)
          .set({
            name: input.name,
            description: input.description,
            imageUrl: input.imageUrl,
            categoryId: input.categoryId,
            estimatedPrepTimeMinutes: input.estimatedPrepTimeMinutes,
            updatedAt: new Date(),
          })
          .where(
            and(eq(posProducts.organizationId, organizationId), eq(posProducts.id, productId)),
          );
        await tx.insert(auditEvents).values({
          organizationId,
          unitId,
          actorIdentityId: identityId,
          action: "pos.product.updated",
          entityType: "product",
          entityId: productId,
          metadata: { name: input.name, categoryId: input.categoryId },
        });
        await tx.insert(outboxEvents).values({
          topic: "pos.catalog_changed",
          aggregateType: "product",
          aggregateId: productId,
          payload: { organizationId, unitId, productId, action: "updated" },
        });
      }
      return { id: productId };
    });
  }

  async archiveProduct(
    identityId: string,
    organizationId: string,
    unitId: string,
    productId: string,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    return this.database.db.transaction(async (tx) => {
      const [product] = await tx
        .update(posProducts)
        .set({ active: false, updatedAt: new Date() })
        .where(and(eq(posProducts.organizationId, organizationId), eq(posProducts.id, productId)))
        .returning({ id: posProducts.id });
      if (!product) throw new NotFoundException({ code: "PRODUCT_NOT_FOUND" });
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "pos.product.archived",
        entityType: "product",
        entityId: productId,
        metadata: {},
      });
      await tx.insert(outboxEvents).values({
        topic: "pos.catalog_changed",
        aggregateType: "product",
        aggregateId: productId,
        payload: { organizationId, unitId, productId, action: "archived" },
      });
      return { id: productId };
    });
  }

  async updateProductUnitConfig(
    identityId: string,
    organizationId: string,
    unitId: string,
    productId: string,
    input: ProductUnitConfigInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    const [product] = await this.database.db
      .select({ id: posProducts.id })
      .from(posProducts)
      .where(and(eq(posProducts.organizationId, organizationId), eq(posProducts.id, productId)))
      .limit(1);
    if (!product) throw new NotFoundException({ code: "PRODUCT_NOT_FOUND" });
    await this.assertStations(organizationId, unitId, input.stationIds);
    const stockDate = await this.unitBusinessDate(organizationId, unitId);
    await this.database.db.transaction(async (tx) => {
      await this.lockAndAssertStations(tx, organizationId, unitId, input.stationIds);
      const existingRoutes = await tx
        .select({ stationId: posProductStations.stationId, stage: posProductStations.stage })
        .from(posProductStations)
        .where(
          and(
            eq(posProductStations.organizationId, organizationId),
            eq(posProductStations.unitId, unitId),
            eq(posProductStations.productId, productId),
          ),
        );
      await tx
        .insert(posProductPrices)
        .values({
          organizationId,
          unitId,
          productId,
          priceCents: input.priceCents,
          deliveryPriceCents: input.deliveryPriceCents,
          costCents: input.costCents,
        })
        .onConflictDoUpdate({
          target: [posProductPrices.unitId, posProductPrices.productId],
          set: {
            priceCents: input.priceCents,
            deliveryPriceCents: input.deliveryPriceCents,
            costCents: input.costCents,
            updatedAt: new Date(),
          },
        });
      await tx
        .insert(posProductAvailability)
        .values({
          organizationId,
          unitId,
          productId,
          available: input.available,
          schedule: input.availabilitySchedule,
          dailyStock: input.dailyStock,
          stockDate,
          autoDeductStock: input.autoDeductStock,
        })
        .onConflictDoUpdate({
          target: [posProductAvailability.unitId, posProductAvailability.productId],
          set: {
            available: input.available,
            schedule: input.availabilitySchedule,
            dailyStock: input.dailyStock,
            soldToday: sql`case when ${posProductAvailability.stockDate} = ${stockDate} then ${posProductAvailability.soldToday} else 0 end`,
            stockDate,
            autoDeductStock: input.autoDeductStock,
            updatedAt: new Date(),
          },
        });
      await tx
        .delete(posProductStations)
        .where(
          and(
            eq(posProductStations.organizationId, organizationId),
            eq(posProductStations.unitId, unitId),
            eq(posProductStations.productId, productId),
          ),
        );
      await tx.insert(posProductStations).values(
        [...new Set(input.stationIds)].map((stationId) => ({
          organizationId,
          unitId,
          productId,
          stationId,
          stage:
            input.stationRouting?.find((route) => route.stationId === stationId)?.stage ??
            existingRoutes.find((route) => route.stationId === stationId)?.stage ??
            1,
        })),
      );
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "pos.product.unit_configured",
        entityType: "product",
        entityId: productId,
        metadata: { priceCents: input.priceCents, available: input.available },
      });
      await tx.insert(outboxEvents).values({
        topic: "pos.catalog_changed",
        aggregateType: "product",
        aggregateId: productId,
        payload: { organizationId, unitId, productId, action: "unit_configured" },
      });
    });
    return { productId, ...input };
  }

  async updateProductAggregate(
    identityId: string,
    organizationId: string,
    unitId: string,
    productId: string,
    input: AggregateProductInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    await this.assertProductReferences(organizationId, unitId, input);
    await this.assertProductIds(
      organizationId,
      input.suggestedProductIds ?? [],
      "SUGGESTED_PRODUCT_NOT_FOUND",
    );
    const stockDate = await this.unitBusinessDate(organizationId, unitId);
    return this.database.db.transaction(async (tx) => {
      await this.lockAndAssertStations(tx, organizationId, unitId, input.stationIds);
      const [existing] = await tx
        .select({ id: posProducts.id })
        .from(posProducts)
        .where(and(eq(posProducts.organizationId, organizationId), eq(posProducts.id, productId)))
        .limit(1);
      if (!existing) throw new NotFoundException({ code: "PRODUCT_NOT_FOUND" });
      const existingRoutes = await tx
        .select({ stationId: posProductStations.stationId, stage: posProductStations.stage })
        .from(posProductStations)
        .where(
          and(
            eq(posProductStations.organizationId, organizationId),
            eq(posProductStations.unitId, unitId),
            eq(posProductStations.productId, productId),
          ),
        );
      await tx
        .update(posProducts)
        .set({
          categoryId: input.categoryId,
          sku: input.sku ?? null,
          ean: input.ean ?? null,
          productType: input.productType ?? "prepared",
          sortOrder: input.sortOrder ?? 0,
          name: input.name,
          description: input.description ?? null,
          imageUrl: input.imageUrl ?? null,
          estimatedPrepTimeMinutes: input.estimatedPrepTimeMinutes ?? null,
          metadata: {
            tags: input.tags ?? [],
            dietaryFlags: input.dietaryFlags ?? [],
            spiciness: input.spiciness ?? null,
            pairing: input.pairing ?? null,
            suggestedProductIds: input.suggestedProductIds ?? [],
            sizes: input.sizes ?? [],
            translations: input.translations ?? {},
            fiscal: input.fiscal ?? {},
          },
          active: true,
          updatedAt: new Date(),
        })
        .where(and(eq(posProducts.organizationId, organizationId), eq(posProducts.id, productId)));
      await tx
        .delete(posProductAllergens)
        .where(
          and(
            eq(posProductAllergens.organizationId, organizationId),
            eq(posProductAllergens.productId, productId),
          ),
        );
      await tx
        .delete(posProductModifierGroups)
        .where(
          and(
            eq(posProductModifierGroups.organizationId, organizationId),
            eq(posProductModifierGroups.productId, productId),
          ),
        );
      await tx
        .delete(posRecipeComponents)
        .where(
          and(
            eq(posRecipeComponents.organizationId, organizationId),
            eq(posRecipeComponents.productId, productId),
          ),
        );
      await tx
        .delete(posProductStations)
        .where(
          and(
            eq(posProductStations.organizationId, organizationId),
            eq(posProductStations.unitId, unitId),
            eq(posProductStations.productId, productId),
          ),
        );
      if (input.allergenIds.length)
        await tx.insert(posProductAllergens).values(
          [...new Set(input.allergenIds)].map((allergenId) => ({
            organizationId,
            productId,
            allergenId,
          })),
        );
      if (input.modifierGroupIds.length)
        await tx.insert(posProductModifierGroups).values(
          [...new Set(input.modifierGroupIds)].map((groupId, sortOrder) => ({
            organizationId,
            productId,
            groupId,
            sortOrder,
          })),
        );
      if (input.recipe.length)
        await tx
          .insert(posRecipeComponents)
          .values(input.recipe.map((component) => ({ organizationId, productId, ...component })));
      await tx.insert(posProductStations).values(
        [...new Set(input.stationIds)].map((stationId) => ({
          organizationId,
          unitId,
          productId,
          stationId,
          stage:
            input.stationRouting?.find((route) => route.stationId === stationId)?.stage ??
            existingRoutes.find((route) => route.stationId === stationId)?.stage ??
            1,
        })),
      );
      await tx
        .insert(posProductPrices)
        .values({
          organizationId,
          unitId,
          productId,
          priceCents: input.priceCents,
          deliveryPriceCents: input.deliveryPriceCents,
          costCents: input.costCents,
        })
        .onConflictDoUpdate({
          target: [posProductPrices.unitId, posProductPrices.productId],
          set: {
            priceCents: input.priceCents,
            deliveryPriceCents: input.deliveryPriceCents,
            costCents: input.costCents,
            updatedAt: new Date(),
          },
        });
      await tx
        .insert(posProductAvailability)
        .values({
          organizationId,
          unitId,
          productId,
          available: input.available,
          schedule: input.availabilitySchedule,
          dailyStock: input.dailyStock,
          soldToday: 0,
          autoDeductStock: input.autoDeductStock ?? false,
          stockDate,
        })
        .onConflictDoUpdate({
          target: [posProductAvailability.unitId, posProductAvailability.productId],
          set: {
            available: input.available,
            schedule: input.availabilitySchedule,
            dailyStock: input.dailyStock,
            soldToday: sql`case when ${posProductAvailability.stockDate} = ${stockDate} then ${posProductAvailability.soldToday} else 0 end`,
            autoDeductStock: input.autoDeductStock ?? false,
            stockDate,
            updatedAt: new Date(),
          },
        });
      await this.recordChange(
        tx,
        identityId,
        organizationId,
        unitId,
        "pos.product.aggregate_updated",
        "product",
        productId,
        { priceCents: input.priceCents },
      );
      return { id: productId };
    });
  }

  async reorderCategories(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: ReorderInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    const existing = await this.database.db
      .select({ id: posCatalogCategories.id })
      .from(posCatalogCategories)
      .where(
        and(
          eq(posCatalogCategories.organizationId, organizationId),
          inArray(
            posCatalogCategories.id,
            input.items.map(({ id }) => id),
          ),
        ),
      );
    if (existing.length !== input.items.length)
      throw new NotFoundException({ code: "CATEGORY_NOT_FOUND" });
    return this.database.db.transaction(async (tx) => {
      for (const item of input.items)
        await tx
          .update(posCatalogCategories)
          .set({ sortOrder: item.sortOrder, updatedAt: new Date() })
          .where(
            and(
              eq(posCatalogCategories.organizationId, organizationId),
              eq(posCatalogCategories.id, item.id),
            ),
          );
      await this.recordChange(
        tx,
        identityId,
        organizationId,
        unitId,
        "pos.categories.reordered",
        "catalog",
        unitId,
        { items: input.items },
      );
      return { updated: input.items.length };
    });
  }

  async reorderProducts(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: ReorderInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    await this.assertProductIds(
      organizationId,
      input.items.map(({ id }) => id),
      "PRODUCT_NOT_FOUND",
    );
    return this.database.db.transaction(async (tx) => {
      for (const item of input.items)
        await tx
          .update(posProducts)
          .set({ sortOrder: item.sortOrder, updatedAt: new Date() })
          .where(and(eq(posProducts.organizationId, organizationId), eq(posProducts.id, item.id)));
      await this.recordChange(
        tx,
        identityId,
        organizationId,
        unitId,
        "pos.products.reordered",
        "catalog",
        unitId,
        { items: input.items },
      );
      return { updated: input.items.length };
    });
  }

  async setCategoryAvailability(
    identityId: string,
    organizationId: string,
    unitId: string,
    categoryId: string,
    input: CategoryAvailabilityInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    const [category] = await this.database.db
      .select({ id: posCatalogCategories.id })
      .from(posCatalogCategories)
      .where(
        and(
          eq(posCatalogCategories.organizationId, organizationId),
          eq(posCatalogCategories.id, categoryId),
        ),
      )
      .limit(1);
    if (!category) throw new NotFoundException({ code: "CATEGORY_NOT_FOUND" });
    const products = await this.database.db
      .select({ id: posProducts.id })
      .from(posProducts)
      .where(
        and(
          eq(posProducts.organizationId, organizationId),
          eq(posProducts.categoryId, categoryId),
          eq(posProducts.active, true),
        ),
      );
    const stockDate = await this.unitBusinessDate(organizationId, unitId);
    return this.database.db.transaction(async (tx) => {
      await tx
        .insert(posCategoryUnitConfigs)
        .values({ organizationId, unitId, categoryId, available: input.available })
        .onConflictDoUpdate({
          target: [posCategoryUnitConfigs.unitId, posCategoryUnitConfigs.categoryId],
          set: { available: input.available, updatedAt: new Date() },
        });
      for (const product of products) {
        await tx
          .insert(posProductAvailability)
          .values({
            organizationId,
            unitId,
            productId: product.id,
            available: input.available,
            stockDate,
          })
          .onConflictDoUpdate({
            target: [posProductAvailability.unitId, posProductAvailability.productId],
            set: { available: input.available, updatedAt: new Date() },
          });
      }
      await this.recordChange(
        tx,
        identityId,
        organizationId,
        unitId,
        "pos.category.availability_updated",
        "category",
        categoryId,
        { available: input.available, products: products.length },
      );
      return { categoryId, available: input.available, updatedProducts: products.length };
    });
  }

  async bulkUpdatePrices(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: BulkPriceInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    await Promise.all([
      this.assertProductIds(organizationId, input.productIds, "PRODUCT_NOT_FOUND"),
      this.assertCatalogIds(
        posCatalogCategories,
        posCatalogCategories.id,
        organizationId,
        input.categoryIds,
        "CATEGORY_NOT_FOUND",
      ),
    ]);
    const selected = await this.database.db
      .select({ id: posProducts.id })
      .from(posProducts)
      .where(
        and(
          eq(posProducts.organizationId, organizationId),
          or(
            input.productIds.length ? inArray(posProducts.id, input.productIds) : undefined,
            input.categoryIds.length
              ? inArray(posProducts.categoryId, input.categoryIds)
              : undefined,
          ),
        ),
      );
    const ids = [...new Set(selected.map(({ id }) => id))];
    if (!ids.length) throw new NotFoundException({ code: "PRODUCT_NOT_FOUND" });
    return this.idempotentCreate(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "catalog.prices.bulk",
      "product_prices",
      input,
      async (tx) => {
        const current = await tx
          .select()
          .from(posProductPrices)
          .where(
            and(
              eq(posProductPrices.organizationId, organizationId),
              eq(posProductPrices.unitId, unitId),
              inArray(posProductPrices.productId, ids),
            ),
          );
        if (current.length !== ids.length)
          throw new NotFoundException({ code: "PRODUCT_PRICE_NOT_FOUND" });
        const changes = current.map((row) => {
          const salonBefore = row.priceCents;
          const deliveryBefore = row.deliveryPriceCents ?? row.priceCents;
          const adjust = (before: number) =>
            input.mode === "fixed"
              ? input.value
              : Math.max(0, Math.round((before * (10_000 + input.value)) / 10_000));
          const salonAfter = adjust(salonBefore);
          const deliveryAfter = adjust(deliveryBefore);
          if (salonAfter > MAX_STORED_CENTS || deliveryAfter > MAX_STORED_CENTS)
            throw new BadRequestException({ code: "PRICE_OUT_OF_RANGE" });
          return {
            productId: row.productId,
            salonBefore,
            salonAfter,
            deliveryBefore,
            deliveryAfter,
          };
        });
        for (const change of changes)
          await tx
            .update(posProductPrices)
            .set(
              input.channel === "salon"
                ? { priceCents: change.salonAfter, updatedAt: new Date() }
                : input.channel === "delivery"
                  ? { deliveryPriceCents: change.deliveryAfter, updatedAt: new Date() }
                  : {
                      priceCents: change.salonAfter,
                      deliveryPriceCents: change.deliveryAfter,
                      updatedAt: new Date(),
                    },
            )
            .where(
              and(
                eq(posProductPrices.organizationId, organizationId),
                eq(posProductPrices.unitId, unitId),
                eq(posProductPrices.productId, change.productId),
              ),
            );
        await this.recordChange(
          tx,
          identityId,
          organizationId,
          unitId,
          "pos.product_prices.bulk_updated",
          "catalog",
          unitId,
          { reason: input.reason, channel: input.channel, changes },
        );
        return { updated: changes.length, changes };
      },
    );
  }

  async updateAllergen(
    identityId: string,
    organizationId: string,
    unitId: string,
    allergenId: string,
    input: UpdateAllergenInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    return this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .update(posAllergens)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(eq(posAllergens.organizationId, organizationId), eq(posAllergens.id, allergenId)),
        )
        .returning();
      if (!row) throw new NotFoundException({ code: "ALLERGEN_NOT_FOUND" });
      await this.recordChange(
        tx,
        identityId,
        organizationId,
        unitId,
        "pos.allergen.updated",
        "allergen",
        allergenId,
        input,
      );
      return row;
    });
  }

  async archiveAllergen(
    identityId: string,
    organizationId: string,
    unitId: string,
    allergenId: string,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    return this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .update(posAllergens)
        .set({ active: false, updatedAt: new Date() })
        .where(
          and(eq(posAllergens.organizationId, organizationId), eq(posAllergens.id, allergenId)),
        )
        .returning({ id: posAllergens.id });
      if (!row) throw new NotFoundException({ code: "ALLERGEN_NOT_FOUND" });
      await this.recordChange(
        tx,
        identityId,
        organizationId,
        unitId,
        "pos.allergen.archived",
        "allergen",
        allergenId,
        {},
      );
      return row;
    });
  }

  async updateStation(
    identityId: string,
    organizationId: string,
    unitId: string,
    stationId: string,
    input: UpdateStationInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    return this.database.db.transaction(async (tx) => {
      await this.lockStationConfiguration(tx, organizationId, unitId, [stationId]);
      if (input.active === false) {
        const [[linkedProduct], [activeTicket], [terminalProfile]] = await Promise.all([
          tx
            .select({ productId: posProductStations.productId })
            .from(posProductStations)
            .innerJoin(
              posProducts,
              and(
                eq(posProducts.organizationId, posProductStations.organizationId),
                eq(posProducts.id, posProductStations.productId),
              ),
            )
            .where(
              and(
                eq(posProductStations.organizationId, organizationId),
                eq(posProductStations.unitId, unitId),
                eq(posProductStations.stationId, stationId),
                eq(posProducts.active, true),
              ),
            )
            .limit(1),
          tx
            .select({ installationId: posKdsTerminalProfiles.installationId })
            .from(posKdsTerminalProfiles)
            .where(
              and(
                eq(posKdsTerminalProfiles.organizationId, organizationId),
                eq(posKdsTerminalProfiles.unitId, unitId),
                eq(posKdsTerminalProfiles.stationId, stationId),
              ),
            )
            .limit(1),
          tx
            .select({ id: posKdsTickets.id })
            .from(posKdsTickets)
            .where(
              and(
                eq(posKdsTickets.organizationId, organizationId),
                eq(posKdsTickets.unitId, unitId),
                eq(posKdsTickets.stationId, stationId),
                or(
                  inArray(posKdsTickets.status, ["pending", "preparing", "ready"]),
                  and(eq(posKdsTickets.status, "done"), isNull(posKdsTickets.servedAt)),
                ),
              ),
            )
            .limit(1),
        ]);
        if (linkedProduct) {
          throw new ConflictException({ code: "STATION_HAS_ACTIVE_PRODUCTS" });
        }
        if (activeTicket) {
          throw new ConflictException({ code: "STATION_HAS_ACTIVE_KDS_TICKETS" });
        }
        if (terminalProfile) {
          throw new ConflictException({ code: "STATION_HAS_KDS_TERMINALS" });
        }
      }
      const [row] = await tx
        .update(posProductionStations)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(
            eq(posProductionStations.organizationId, organizationId),
            eq(posProductionStations.unitId, unitId),
            eq(posProductionStations.id, stationId),
          ),
        )
        .returning();
      if (!row) throw new NotFoundException({ code: "STATION_NOT_FOUND" });
      await this.recordChange(
        tx,
        identityId,
        organizationId,
        unitId,
        "pos.station.updated",
        "production_station",
        stationId,
        input,
      );
      return row;
    });
  }

  async archiveStation(
    identityId: string,
    organizationId: string,
    unitId: string,
    stationId: string,
  ) {
    return this.updateStation(identityId, organizationId, unitId, stationId, { active: false });
  }

  async updateModifierGroup(
    identityId: string,
    organizationId: string,
    unitId: string,
    groupId: string,
    input: UpdateModifierGroupInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    return this.database.db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          minimumSelections: posModifierGroups.minimumSelections,
          maximumSelections: posModifierGroups.maximumSelections,
        })
        .from(posModifierGroups)
        .where(
          and(
            eq(posModifierGroups.organizationId, organizationId),
            eq(posModifierGroups.id, groupId),
          ),
        )
        .limit(1);
      if (!current) throw new NotFoundException({ code: "MODIFIER_GROUP_NOT_FOUND" });
      if (
        (input.minimumSelections ?? current.minimumSelections) >
        (input.maximumSelections ?? current.maximumSelections)
      )
        throw new BadRequestException({ code: "MODIFIER_SELECTION_RANGE_INVALID" });
      const [group] = await tx
        .update(posModifierGroups)
        .set({
          name: input.name,
          minimumSelections: input.minimumSelections,
          maximumSelections: input.maximumSelections,
          active: input.active,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(posModifierGroups.organizationId, organizationId),
            eq(posModifierGroups.id, groupId),
          ),
        )
        .returning();
      if (!group) throw new NotFoundException({ code: "MODIFIER_GROUP_NOT_FOUND" });
      if (input.options) {
        await tx
          .update(posModifierOptions)
          .set({ active: false, updatedAt: new Date() })
          .where(
            and(
              eq(posModifierOptions.organizationId, organizationId),
              eq(posModifierOptions.groupId, groupId),
            ),
          );
        await tx
          .insert(posModifierOptions)
          .values(input.options.map((option) => ({ organizationId, groupId, ...option })));
      }
      await this.recordChange(
        tx,
        identityId,
        organizationId,
        unitId,
        "pos.modifier_group.updated",
        "modifier_group",
        groupId,
        {},
      );
      return group;
    });
  }

  async archiveModifierGroup(
    identityId: string,
    organizationId: string,
    unitId: string,
    groupId: string,
  ) {
    return this.updateModifierGroup(identityId, organizationId, unitId, groupId, { active: false });
  }

  async createModifierOption(
    identityId: string,
    organizationId: string,
    unitId: string,
    groupId: string,
    idempotencyKey: string,
    input: ModifierOptionInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    return this.idempotentCreate(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "catalog.modifier_option.create",
      "modifier_option",
      { groupId, ...input },
      async (tx) => {
        const [group] = await tx
          .select({ id: posModifierGroups.id })
          .from(posModifierGroups)
          .where(
            and(
              eq(posModifierGroups.organizationId, organizationId),
              eq(posModifierGroups.id, groupId),
              eq(posModifierGroups.active, true),
            ),
          )
          .limit(1);
        if (!group) throw new NotFoundException({ code: "MODIFIER_GROUP_NOT_FOUND" });
        const [option] = await tx
          .insert(posModifierOptions)
          .values({ organizationId, groupId, ...input })
          .returning();
        if (!option) throw new Error("Modifier option insert did not return a row");
        await this.recordChange(
          tx,
          identityId,
          organizationId,
          unitId,
          "pos.modifier_option.created",
          "modifier_option",
          option.id,
          {},
        );
        return option;
      },
    );
  }

  async updateModifierOption(
    identityId: string,
    organizationId: string,
    unitId: string,
    optionId: string,
    input: UpdateModifierOptionInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    return this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .update(posModifierOptions)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(
            eq(posModifierOptions.organizationId, organizationId),
            eq(posModifierOptions.id, optionId),
          ),
        )
        .returning();
      if (!row) throw new NotFoundException({ code: "MODIFIER_OPTION_NOT_FOUND" });
      await this.recordChange(
        tx,
        identityId,
        organizationId,
        unitId,
        "pos.modifier_option.updated",
        "modifier_option",
        optionId,
        input,
      );
      return row;
    });
  }

  async archiveModifierOption(
    identityId: string,
    organizationId: string,
    unitId: string,
    optionId: string,
  ) {
    return this.updateModifierOption(identityId, organizationId, unitId, optionId, {
      active: false,
    });
  }

  async updateCombo(
    identityId: string,
    organizationId: string,
    unitId: string,
    comboId: string,
    input: ComboInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    await this.assertProductIds(
      organizationId,
      input.items.map(({ productId }) => productId),
      "COMBO_PRODUCT_NOT_FOUND",
    );
    return this.database.db.transaction(async (tx) => {
      const [combo] = await tx
        .update(posCombos)
        .set({
          name: input.name,
          description: input.description,
          imageUrl: input.imageUrl,
          priceCents: input.priceCents,
          active: input.active,
          updatedAt: new Date(),
        })
        .where(and(eq(posCombos.organizationId, organizationId), eq(posCombos.id, comboId)))
        .returning();
      if (!combo) throw new NotFoundException({ code: "COMBO_NOT_FOUND" });
      await tx
        .delete(posComboItems)
        .where(
          and(eq(posComboItems.organizationId, organizationId), eq(posComboItems.comboId, comboId)),
        );
      await tx
        .insert(posComboItems)
        .values(input.items.map((item) => ({ organizationId, comboId, ...item })));
      await this.recordChange(
        tx,
        identityId,
        organizationId,
        unitId,
        "pos.combo.updated",
        "combo",
        comboId,
        { priceCents: input.priceCents },
      );
      return combo;
    });
  }

  async archiveCombo(identityId: string, organizationId: string, unitId: string, comboId: string) {
    await this.requireManager(identityId, organizationId, unitId);
    return this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .update(posCombos)
        .set({ active: false, updatedAt: new Date() })
        .where(and(eq(posCombos.organizationId, organizationId), eq(posCombos.id, comboId)))
        .returning({ id: posCombos.id });
      if (!row) throw new NotFoundException({ code: "COMBO_NOT_FOUND" });
      await this.recordChange(
        tx,
        identityId,
        organizationId,
        unitId,
        "pos.combo.archived",
        "combo",
        comboId,
        {},
      );
      return row;
    });
  }

  async createPromotion(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: PromotionInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    await this.assertPromotionReferences(organizationId, input);
    return this.idempotentCreate(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "catalog.promotion.create",
      "promotion",
      input,
      async (tx) => {
        const [promotion] = await tx
          .insert(posCatalogPromotions)
          .values({
            organizationId,
            unitId,
            ...input,
            startsAt: input.startsAt ? new Date(input.startsAt) : null,
            endsAt: input.endsAt ? new Date(input.endsAt) : null,
          })
          .returning();
        if (!promotion) throw new Error("Promotion insert did not return a row");
        await this.recordChange(
          tx,
          identityId,
          organizationId,
          unitId,
          "pos.promotion.created",
          "promotion",
          promotion.id,
          {},
        );
        return promotion;
      },
    );
  }

  async updatePromotion(
    identityId: string,
    organizationId: string,
    unitId: string,
    promotionId: string,
    input: UpdatePromotionInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    const current = await this.database.db
      .select()
      .from(posCatalogPromotions)
      .where(
        and(
          eq(posCatalogPromotions.organizationId, organizationId),
          eq(posCatalogPromotions.unitId, unitId),
          eq(posCatalogPromotions.id, promotionId),
        ),
      )
      .limit(1);
    if (!current[0]) throw new NotFoundException({ code: "PROMOTION_NOT_FOUND" });
    const mergedResult = promotionSchema.safeParse({
      ...current[0],
      ...input,
      startsAt: input.startsAt === undefined ? current[0].startsAt?.toISOString() : input.startsAt,
      endsAt: input.endsAt === undefined ? current[0].endsAt?.toISOString() : input.endsAt,
    });
    if (!mergedResult.success) throw new BadRequestException({ code: "PROMOTION_INVALID" });
    const merged = mergedResult.data;
    await this.assertPromotionReferences(organizationId, merged);
    return this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .update(posCatalogPromotions)
        .set({
          ...input,
          startsAt:
            input.startsAt === undefined
              ? undefined
              : input.startsAt
                ? new Date(input.startsAt)
                : null,
          endsAt:
            input.endsAt === undefined ? undefined : input.endsAt ? new Date(input.endsAt) : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(posCatalogPromotions.organizationId, organizationId),
            eq(posCatalogPromotions.unitId, unitId),
            eq(posCatalogPromotions.id, promotionId),
          ),
        )
        .returning();
      if (!row) throw new NotFoundException({ code: "PROMOTION_NOT_FOUND" });
      await this.recordChange(
        tx,
        identityId,
        organizationId,
        unitId,
        "pos.promotion.updated",
        "promotion",
        promotionId,
        input,
      );
      return row;
    });
  }

  async archivePromotion(
    identityId: string,
    organizationId: string,
    unitId: string,
    promotionId: string,
  ) {
    return this.updatePromotion(identityId, organizationId, unitId, promotionId, { active: false });
  }

  async getBranding(identityId: string, organizationId: string, unitId: string) {
    return this.establishmentSettings.getLegacyBranding(identityId, organizationId, unitId);
  }

  async updateBranding(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: BrandingInput,
  ) {
    return this.establishmentSettings.updateLegacyBranding(
      identityId,
      organizationId,
      unitId,
      input,
    );
  }

  async importCatalog(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: ImportCatalogInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    const errors: { row: number; code: string }[] = [];
    for (const [index, row] of input.rows.entries()) {
      try {
        await Promise.all([
          this.assertIds(
            posAllergens,
            posAllergens.id,
            organizationId,
            row.allergenIds,
            "ALLERGEN_NOT_FOUND",
          ),
          this.assertIds(
            posModifierGroups,
            posModifierGroups.id,
            organizationId,
            row.modifierGroupIds,
            "MODIFIER_GROUP_NOT_FOUND",
          ),
          this.assertStations(organizationId, unitId, row.stationIds),
          this.assertProductIds(
            organizationId,
            row.suggestedProductIds ?? [],
            "SUGGESTED_PRODUCT_NOT_FOUND",
          ),
          row.categoryId
            ? this.assertCatalogIds(
                posCatalogCategories,
                posCatalogCategories.id,
                organizationId,
                [row.categoryId],
                "CATEGORY_NOT_FOUND",
              )
            : Promise.resolve(),
          row.productId
            ? this.assertProductIds(organizationId, [row.productId], "PRODUCT_NOT_FOUND")
            : Promise.resolve(),
        ]);
      } catch (error) {
        errors.push({
          row: index + 1,
          code:
            error instanceof NotFoundException ? String(error.getResponse()) : "INVALID_REFERENCE",
        });
      }
    }
    if (errors.length || input.dryRun)
      return { valid: errors.length === 0, rows: input.rows.length, errors, dryRun: true };
    const stockDate = await this.unitBusinessDate(organizationId, unitId);
    return this.idempotentCreate(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "catalog.import",
      "catalog",
      input,
      async (tx) => {
        await this.lockAndAssertStations(
          tx,
          organizationId,
          unitId,
          input.rows.flatMap((row) => row.stationIds),
        );
        const affected: string[] = [];
        for (const row of input.rows) {
          let categoryId = row.categoryId;
          if (!categoryId && row.categoryName) {
            const [existingCategory] = await tx
              .select({ id: posCatalogCategories.id })
              .from(posCatalogCategories)
              .where(
                and(
                  eq(posCatalogCategories.organizationId, organizationId),
                  sql`lower(${posCatalogCategories.name}) = lower(${row.categoryName})`,
                ),
              )
              .limit(1);
            categoryId = existingCategory?.id;
            if (!categoryId) {
              const baseSlug =
                row.categoryName
                  .normalize("NFD")
                  .replace(/[\u0300-\u036f]/g, "")
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-|-$/g, "")
                  .slice(0, 88) || "categoria";
              const [createdCategory] = await tx
                .insert(posCatalogCategories)
                .values({
                  organizationId,
                  name: row.categoryName,
                  slug: `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`,
                })
                .returning({ id: posCatalogCategories.id });
              categoryId = createdCategory?.id;
            }
          }
          if (!categoryId) throw new BadRequestException({ code: "IMPORT_CATEGORY_REQUIRED" });
          let productId = row.productId;
          const core = {
            organizationId,
            categoryId,
            sku: row.sku,
            ean: row.ean,
            productType: row.productType ?? "prepared",
            sortOrder: row.sortOrder ?? 0,
            name: row.name,
            description: row.description,
            imageUrl: row.imageUrl,
            estimatedPrepTimeMinutes: row.estimatedPrepTimeMinutes,
            metadata: {
              tags: row.tags ?? [],
              dietaryFlags: row.dietaryFlags ?? [],
              spiciness: row.spiciness ?? null,
              pairing: row.pairing ?? null,
              suggestedProductIds: row.suggestedProductIds ?? [],
              sizes: row.sizes ?? [],
              translations: row.translations ?? {},
              fiscal: row.fiscal ?? {},
            },
          };
          if (productId) {
            const [updated] = await tx
              .update(posProducts)
              .set({ ...core, updatedAt: new Date() })
              .where(
                and(eq(posProducts.organizationId, organizationId), eq(posProducts.id, productId)),
              )
              .returning({ id: posProducts.id });
            if (!updated) throw new NotFoundException({ code: "PRODUCT_NOT_FOUND" });
          } else {
            const [created] = await tx
              .insert(posProducts)
              .values(core)
              .returning({ id: posProducts.id });
            productId = created?.id;
          }
          if (!productId) throw new Error("Product import did not return an id");
          await tx
            .delete(posProductAllergens)
            .where(
              and(
                eq(posProductAllergens.organizationId, organizationId),
                eq(posProductAllergens.productId, productId),
              ),
            );
          await tx
            .delete(posProductModifierGroups)
            .where(
              and(
                eq(posProductModifierGroups.organizationId, organizationId),
                eq(posProductModifierGroups.productId, productId),
              ),
            );
          await tx
            .delete(posRecipeComponents)
            .where(
              and(
                eq(posRecipeComponents.organizationId, organizationId),
                eq(posRecipeComponents.productId, productId),
              ),
            );
          await tx
            .delete(posProductStations)
            .where(
              and(
                eq(posProductStations.organizationId, organizationId),
                eq(posProductStations.unitId, unitId),
                eq(posProductStations.productId, productId),
              ),
            );
          if (row.allergenIds.length)
            await tx
              .insert(posProductAllergens)
              .values(
                row.allergenIds.map((allergenId) => ({ organizationId, productId, allergenId })),
              );
          if (row.modifierGroupIds.length)
            await tx.insert(posProductModifierGroups).values(
              row.modifierGroupIds.map((groupId, sortOrder) => ({
                organizationId,
                productId,
                groupId,
                sortOrder,
              })),
            );
          if (row.recipe.length)
            await tx
              .insert(posRecipeComponents)
              .values(row.recipe.map((component) => ({ organizationId, productId, ...component })));
          await tx
            .insert(posProductStations)
            .values(
              row.stationIds.map((stationId) => ({ organizationId, unitId, productId, stationId })),
            );
          await tx
            .insert(posProductPrices)
            .values({
              organizationId,
              unitId,
              productId,
              priceCents: row.priceCents,
              deliveryPriceCents: row.deliveryPriceCents,
              costCents: row.costCents,
            })
            .onConflictDoUpdate({
              target: [posProductPrices.unitId, posProductPrices.productId],
              set: {
                priceCents: row.priceCents,
                deliveryPriceCents: row.deliveryPriceCents,
                costCents: row.costCents,
                updatedAt: new Date(),
              },
            });
          await tx
            .insert(posProductAvailability)
            .values({
              organizationId,
              unitId,
              productId,
              available: row.available,
              schedule: row.availabilitySchedule,
              dailyStock: row.dailyStock,
              soldToday: 0,
              autoDeductStock: row.autoDeductStock ?? false,
              stockDate,
            })
            .onConflictDoUpdate({
              target: [posProductAvailability.unitId, posProductAvailability.productId],
              set: {
                available: row.available,
                schedule: row.availabilitySchedule,
                dailyStock: row.dailyStock,
                soldToday: sql`case when ${posProductAvailability.stockDate} = ${stockDate} then ${posProductAvailability.soldToday} else 0 end`,
                autoDeductStock: row.autoDeductStock ?? false,
                stockDate,
                updatedAt: new Date(),
              },
            });
          affected.push(productId);
        }
        await this.recordChange(
          tx,
          identityId,
          organizationId,
          unitId,
          "pos.catalog.imported",
          "catalog",
          unitId,
          { affected },
        );
        return { imported: affected.length, productIds: affected };
      },
    );
  }

  async getPublication(identityId: string, organizationId: string, unitId: string) {
    await this.requireAccess(identityId, organizationId, unitId);
    const [row] = await this.database.db
      .select({
        slug: publicMenus.slug,
        active: publicMenus.active,
        publishedAt: publicMenus.publishedAt,
        version: publicMenus.version,
      })
      .from(publicMenus)
      .where(and(eq(publicMenus.organizationId, organizationId), eq(publicMenus.unitId, unitId)))
      .limit(1);
    return row
      ? {
          ...row,
          url: new URL(
            `/m/${row.slug}`,
            process.env.CUSTOMER_APP_URL ?? "http://localhost:3101",
          ).toString(),
        }
      : null;
  }

  async publish(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: PublicationInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    return this.idempotentCreate(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "catalog.publish",
      "public_menu",
      input,
      async (tx) => {
        const [
          categories,
          products,
          prices,
          availability,
          allergens,
          productAllergens,
          modifierGroups,
          modifierOptions,
          productModifierGroups,
          branding,
          promotions,
          unitSettings,
        ] = await Promise.all([
          tx
            .select()
            .from(posCatalogCategories)
            .where(
              and(
                eq(posCatalogCategories.organizationId, organizationId),
                eq(posCatalogCategories.active, true),
              ),
            ),
          tx
            .select()
            .from(posProducts)
            .where(
              and(eq(posProducts.organizationId, organizationId), eq(posProducts.active, true)),
            ),
          tx
            .select()
            .from(posProductPrices)
            .where(
              and(
                eq(posProductPrices.organizationId, organizationId),
                eq(posProductPrices.unitId, unitId),
              ),
            ),
          tx
            .select()
            .from(posProductAvailability)
            .where(
              and(
                eq(posProductAvailability.organizationId, organizationId),
                eq(posProductAvailability.unitId, unitId),
              ),
            ),
          tx.select().from(posAllergens).where(eq(posAllergens.organizationId, organizationId)),
          tx
            .select()
            .from(posProductAllergens)
            .where(eq(posProductAllergens.organizationId, organizationId)),
          tx
            .select()
            .from(posModifierGroups)
            .where(
              and(
                eq(posModifierGroups.organizationId, organizationId),
                eq(posModifierGroups.active, true),
              ),
            ),
          tx
            .select()
            .from(posModifierOptions)
            .where(
              and(
                eq(posModifierOptions.organizationId, organizationId),
                eq(posModifierOptions.active, true),
              ),
            ),
          tx
            .select()
            .from(posProductModifierGroups)
            .where(eq(posProductModifierGroups.organizationId, organizationId)),
          tx
            .select()
            .from(posCatalogBranding)
            .where(
              and(
                eq(posCatalogBranding.organizationId, organizationId),
                eq(posCatalogBranding.unitId, unitId),
              ),
            )
            .limit(1),
          tx
            .select()
            .from(posCatalogPromotions)
            .where(
              and(
                eq(posCatalogPromotions.organizationId, organizationId),
                eq(posCatalogPromotions.unitId, unitId),
                eq(posCatalogPromotions.active, true),
              ),
            ),
          tx
            .select({
              timezone: units.timezone,
              unitName: units.name,
              tradeName: organizations.tradeName,
            })
            .from(units)
            .innerJoin(organizations, eq(organizations.id, units.organizationId))
            .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
            .limit(1),
        ]);
        const now = new Date();
        const items = products.map((product) => ({
          ...product,
          price: prices.find((row) => row.productId === product.id) ?? null,
          availability: availability.find((row) => row.productId === product.id) ?? null,
          allergenIds: productAllergens
            .filter((row) => row.productId === product.id)
            .map((row) => row.allergenId),
          modifierGroupIds: productModifierGroups
            .filter((row) => row.productId === product.id)
            .map((row) => row.groupId),
        }));
        const metadata = {
          branding: projectPublicBranding(
            branding[0]?.config,
            unitSettings[0]?.tradeName ?? unitSettings[0]?.unitName ?? "Estabelecimento",
            unitSettings[0]?.timezone ?? "America/Sao_Paulo",
          ),
          categories,
          modifierGroups: modifierGroups.map((group) => ({
            ...group,
            options: modifierOptions.filter((option) => option.groupId === group.id),
          })),
          allergens,
          promotions,
          defaultLocale: "pt-BR",
          publishedAt: now.toISOString(),
        };
        const [existing] = await tx
          .select({ id: publicMenus.id, version: publicMenus.version })
          .from(publicMenus)
          .where(
            and(eq(publicMenus.organizationId, organizationId), eq(publicMenus.unitId, unitId)),
          )
          .limit(1);
        const version = (existing?.version ?? 0) + 1;
        const [menu] = existing
          ? await tx
              .update(publicMenus)
              .set({
                slug: input.slug,
                active: input.active,
                items,
                metadata,
                version,
                publishedAt: now,
                updatedAt: now,
              })
              .where(eq(publicMenus.id, existing.id))
              .returning()
          : await tx
              .insert(publicMenus)
              .values({
                organizationId,
                unitId,
                slug: input.slug,
                active: input.active,
                items,
                metadata,
                version,
                publishedAt: now,
              })
              .returning();
        if (!menu) throw new Error("Public menu write did not return a row");
        await this.recordChange(
          tx,
          identityId,
          organizationId,
          unitId,
          "pos.catalog.published",
          "public_menu",
          menu.id,
          { slug: menu.slug, version },
        );
        return {
          slug: menu.slug,
          active: menu.active,
          publishedAt: menu.publishedAt,
          version,
          url: new URL(
            `/m/${menu.slug}`,
            process.env.CUSTOMER_APP_URL ?? "http://localhost:3101",
          ).toString(),
        };
      },
    );
  }

  async analyticsBcg(
    identityId: string,
    organizationId: string,
    unitId: string,
    query: AnalyticsQueryInput,
  ) {
    await this.requireAccess(identityId, organizationId, unitId);
    const from = query.from ? new Date(query.from) : new Date(Date.now() - 30 * 86_400_000);
    const to = query.to ? new Date(query.to) : new Date();
    if (from >= to) throw new BadRequestException({ code: "ANALYTICS_PERIOD_INVALID" });
    const sold = await this.database.db
      .select({
        productId: posOrderItems.productId,
        name: posOrderItems.productName,
        quantity: sql<number>`sum(${posOrderItems.quantity})::int`,
        revenueCents: sql<number>`sum(${posOrderItems.netCents})::int`,
        costCents: sql<number>`sum(${posOrderItems.quantity} * coalesce(${posProductPrices.costCents}, 0))::int`,
      })
      .from(posOrderItems)
      .leftJoin(
        posProductPrices,
        and(
          eq(posProductPrices.organizationId, posOrderItems.organizationId),
          eq(posProductPrices.unitId, posOrderItems.unitId),
          eq(posProductPrices.productId, posOrderItems.productId),
        ),
      )
      .where(
        and(
          eq(posOrderItems.organizationId, organizationId),
          eq(posOrderItems.unitId, unitId),
          ne(posOrderItems.status, "canceled"),
          gte(posOrderItems.createdAt, from),
          lte(posOrderItems.createdAt, to),
        ),
      )
      .groupBy(posOrderItems.productId, posOrderItems.productName);
    const activeProducts = await this.database.db
      .select({
        productId: posProducts.id,
        name: posProducts.name,
        costCents: posProductPrices.costCents,
      })
      .from(posProducts)
      .leftJoin(
        posProductPrices,
        and(
          eq(posProductPrices.organizationId, posProducts.organizationId),
          eq(posProductPrices.unitId, unitId),
          eq(posProductPrices.productId, posProducts.id),
        ),
      )
      .where(and(eq(posProducts.organizationId, organizationId), eq(posProducts.active, true)));
    const rows = activeProducts.map(
      (product) =>
        sold.find((row) => row.productId === product.productId) ?? {
          productId: product.productId,
          name: product.name,
          quantity: 0,
          revenueCents: 0,
          costCents: 0,
        },
    );
    const averageRevenue =
      rows.reduce((sum, row) => sum + Number(row.revenueCents), 0) / Math.max(rows.length, 1);
    const averageMargin =
      rows.reduce((sum, row) => sum + Number(row.revenueCents) - Number(row.costCents), 0) /
      Math.max(rows.length, 1);
    return {
      from,
      to,
      costBasis: "current_cost",
      products: rows.map((row) => {
        const revenueCents = Number(row.revenueCents);
        const costCents = Number(row.costCents);
        const marginCents = revenueCents - costCents;
        return {
          ...row,
          quantity: Number(row.quantity),
          revenueCents,
          costCents,
          marginCents,
          quadrant:
            revenueCents >= averageRevenue
              ? marginCents >= averageMargin
                ? "star"
                : "volume"
              : marginCents >= averageMargin
                ? "opportunity"
                : "dog",
        };
      }),
    };
  }

  async uploadMedia(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: MediaUploadInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    const bytes = Buffer.from(input.base64, "base64");
    if (bytes.length === 0 || bytes.length > 2_000_000)
      throw new BadRequestException({ code: "MEDIA_SIZE_INVALID" });
    const signatures = [
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
    ];
    const detected = signatures.find(({ matches }) => matches);
    if (!detected || detected.mime !== input.mimeType)
      throw new BadRequestException({ code: "MEDIA_SIGNATURE_INVALID" });
    const key = `${randomBytes(16).toString("hex")}.${detected.extension}`;
    const mediaRoot = resolve(process.env.MEDIA_ROOT ?? "data/media");
    await mkdir(mediaRoot, { recursive: true });
    const target = resolve(mediaRoot, key);
    const temporary = `${target}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      await writeFile(temporary, bytes, { flag: "wx" });
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    const apiUrl = new URL(process.env.API_URL ?? "http://localhost:3200");
    const url = new URL(`/public/v1/media/${key}`, apiUrl).toString();
    try {
      await this.database.db.transaction(async (tx) => {
        await tx.insert(auditEvents).values({
          organizationId,
          unitId,
          actorIdentityId: identityId,
          action: "media.uploaded",
          entityType: "media",
          entityId: key,
          metadata: {
            key,
            fileName: input.fileName,
            mimeType: input.mimeType,
            size: bytes.length,
          },
        });
        await tx.insert(outboxEvents).values({
          topic: "media.uploaded",
          aggregateType: "media",
          aggregateId: key,
          payload: { organizationId, unitId, key },
        });
      });
    } catch (error) {
      await unlink(target).catch(() => undefined);
      throw error;
    }
    return { key, url };
  }

  async deleteMedia(identityId: string, organizationId: string, unitId: string, key: string) {
    await this.requireManager(identityId, organizationId, unitId);
    if (!/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(key)) {
      throw new BadRequestException({ code: "MEDIA_KEY_INVALID" });
    }
    const [owned] = await this.database.db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, organizationId),
          eq(auditEvents.unitId, unitId),
          eq(auditEvents.action, "media.uploaded"),
          eq(auditEvents.entityId, key),
        ),
      )
      .limit(1);
    if (!owned) throw new NotFoundException({ code: "MEDIA_NOT_FOUND" });
    const [branding, products, menus] = await Promise.all([
      this.database.db
        .select({ config: posCatalogBranding.config })
        .from(posCatalogBranding)
        .where(
          and(
            eq(posCatalogBranding.organizationId, organizationId),
            eq(posCatalogBranding.unitId, unitId),
          ),
        ),
      this.database.db
        .select({ imageUrl: posProducts.imageUrl })
        .from(posProducts)
        .where(eq(posProducts.organizationId, organizationId)),
      this.database.db
        .select({ metadata: publicMenus.metadata })
        .from(publicMenus)
        .where(and(eq(publicMenus.organizationId, organizationId), eq(publicMenus.unitId, unitId))),
    ]);
    const referenced = [...branding, ...products, ...menus].some((row) =>
      JSON.stringify(row).includes(key),
    );
    if (referenced) throw new ConflictException({ code: "MEDIA_IN_USE" });
    await unlink(resolve(process.env.MEDIA_ROOT ?? "data/media", key)).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
    await this.database.db.transaction(async (tx) => {
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "media.deleted",
        entityType: "media",
        entityId: key,
      });
      await tx.insert(outboxEvents).values({
        topic: "media.deleted",
        aggregateType: "media",
        aggregateId: key,
        payload: { organizationId, unitId, key },
      });
    });
  }

  async setDailyStock(
    identityId: string,
    organizationId: string,
    unitId: string,
    productId: string,
    input: DailyStockInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    const stockDate = await this.unitBusinessDate(organizationId, unitId);
    return this.database.db.transaction(async (tx) => {
      const [product] = await tx
        .select({ id: posProducts.id })
        .from(posProducts)
        .where(and(eq(posProducts.organizationId, organizationId), eq(posProducts.id, productId)))
        .limit(1);
      if (!product) throw new NotFoundException({ code: "PRODUCT_NOT_FOUND" });
      const [availability] = await tx
        .insert(posProductAvailability)
        .values({
          organizationId,
          unitId,
          productId,
          dailyStock: input.remaining,
          soldToday: 0,
          stockDate,
          autoDeductStock: input.autoDeductStock ?? false,
        })
        .onConflictDoUpdate({
          target: [posProductAvailability.unitId, posProductAvailability.productId],
          set: {
            dailyStock: input.remaining,
            soldToday: 0,
            stockDate,
            autoDeductStock: input.autoDeductStock,
            updatedAt: new Date(),
          },
        })
        .returning();
      await this.recordChange(
        tx,
        identityId,
        organizationId,
        unitId,
        "pos.product.daily_stock_set",
        "product",
        productId,
        { remaining: input.remaining, stockDate },
      );
      return {
        productId,
        remaining: availability?.dailyStock ?? input.remaining,
        stockDate,
        autoDeductStock: availability?.autoDeductStock ?? input.autoDeductStock ?? false,
      };
    });
  }

  async getTableQrSettings(identityId: string, organizationId: string, unitId: string) {
    await this.requireManager(identityId, organizationId, unitId);
    const [settings, unit, branding] = await Promise.all([
      this.database.db
        .select()
        .from(posTableQrSettings)
        .where(
          and(
            eq(posTableQrSettings.organizationId, organizationId),
            eq(posTableQrSettings.unitId, unitId),
          ),
        )
        .limit(1),
      this.database.db
        .select({ name: units.name })
        .from(units)
        .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
        .limit(1),
      this.database.db
        .select({ config: posCatalogBranding.config })
        .from(posCatalogBranding)
        .where(
          and(
            eq(posCatalogBranding.organizationId, organizationId),
            eq(posCatalogBranding.unitId, unitId),
          ),
        )
        .limit(1),
    ]);
    if (!unit[0]) throw new NotFoundException({ code: "UNIT_NOT_FOUND" });
    return this.tableQrSettingsView(settings[0], unit[0].name, branding[0]?.config);
  }

  async updateTableQrSettings(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: UpdateTableQrSettingsInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    return this.idempotentCreate(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "table-qr.settings.update",
      "table_qr_settings",
      input,
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`table-qr-settings:${organizationId}:${unitId}`}))`,
        );
        const [existing] = await tx
          .select({ revision: posTableQrSettings.revision })
          .from(posTableQrSettings)
          .where(
            and(
              eq(posTableQrSettings.organizationId, organizationId),
              eq(posTableQrSettings.unitId, unitId),
            ),
          )
          .limit(1);
        const currentRevision = existing?.revision ?? 0;
        if (currentRevision !== input.expectedRevision) {
          throw new ConflictException({
            code: "TABLE_QR_SETTINGS_REVISION_CONFLICT",
            message: "As configurações de QR foram alteradas. Recarregue antes de salvar.",
            currentRevision,
          });
        }
        const revision = currentRevision + 1;
        const { expectedRevision: _, ...values } = input;
        const [settings] = await tx
          .insert(posTableQrSettings)
          .values({
            organizationId,
            unitId,
            revision,
            ...values,
            updatedByIdentityId: identityId,
          })
          .onConflictDoUpdate({
            target: [posTableQrSettings.organizationId, posTableQrSettings.unitId],
            set: { revision, ...values, updatedByIdentityId: identityId, updatedAt: new Date() },
          })
          .returning();
        if (!settings) throw new Error("Table QR settings write did not return a row");
        await this.recordChange(
          tx,
          identityId,
          organizationId,
          unitId,
          "pos.table_qr.settings_updated",
          "table_qr_settings",
          unitId,
          { revision },
        );
        return this.tableQrSettingsView(settings, "", null);
      },
    );
  }

  async createTableQrPrintBatch(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: CreateTableQrPrintBatchInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    return this.idempotentCreate(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "table-qr.print-batch.create",
      "table_qr_print_batch",
      input,
      async (tx) => {
        const [menu] = await tx
          .select({ slug: publicMenus.slug })
          .from(publicMenus)
          .where(
            and(
              eq(publicMenus.organizationId, organizationId),
              eq(publicMenus.unitId, unitId),
              eq(publicMenus.active, true),
            ),
          )
          .limit(1);
        if (!menu) throw new NotFoundException({ code: "PUBLIC_MENU_NOT_FOUND" });

        const [storedSettings, unit, branding, author] = await Promise.all([
          tx
            .select()
            .from(posTableQrSettings)
            .where(
              and(
                eq(posTableQrSettings.organizationId, organizationId),
                eq(posTableQrSettings.unitId, unitId),
              ),
            )
            .limit(1),
          tx
            .select({ name: units.name })
            .from(units)
            .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
            .limit(1),
          tx
            .select({ config: posCatalogBranding.config })
            .from(posCatalogBranding)
            .where(
              and(
                eq(posCatalogBranding.organizationId, organizationId),
                eq(posCatalogBranding.unitId, unitId),
              ),
            )
            .limit(1),
          tx
            .select({ displayName: identities.displayName })
            .from(identities)
            .where(eq(identities.id, identityId))
            .limit(1),
        ]);
        if (!unit[0]) throw new NotFoundException({ code: "UNIT_NOT_FOUND" });
        const settings = this.tableQrSettingsView(
          storedSettings[0],
          unit[0].name,
          branding[0]?.config,
        );
        const tableIds = [...new Set(input.tableIds)];
        const tables = await tx
          .select({
            tableId: posDiningTables.id,
            label: posDiningTables.label,
            tokenVersion: posDiningTables.publicAccessVersion,
          })
          .from(posDiningTables)
          .where(
            and(
              eq(posDiningTables.organizationId, organizationId),
              eq(posDiningTables.unitId, unitId),
              eq(posDiningTables.active, true),
              inArray(posDiningTables.id, tableIds),
            ),
          )
          .orderBy(asc(posDiningTables.label), asc(posDiningTables.id));
        if (tables.length !== tableIds.length) {
          throw new NotFoundException({ code: "TABLE_QR_BATCH_TABLE_NOT_FOUND" });
        }
        const { revision: settingsRevision, updatedAt: _, ...settingsSnapshot } = settings;
        if (!input.includeWifi) settingsSnapshot.wifiNotice = null;
        const [batch] = await tx
          .insert(posTableQrPrintBatches)
          .values({
            organizationId,
            unitId,
            format: input.format,
            output: input.output,
            template: input.template ?? settings.template,
            menuSlug: menu.slug,
            includeWifi: input.includeWifi,
            settingsRevision,
            settingsSnapshot,
            tablesSnapshot: tables,
            createdByIdentityId: identityId,
          })
          .returning();
        if (!batch) throw new Error("Table QR print batch insert did not return a row");
        await this.recordChange(
          tx,
          identityId,
          organizationId,
          unitId,
          "pos.table_qr.print_batch_generated",
          "table_qr_print_batch",
          batch.id,
          {
            format: input.format,
            output: input.output,
            tableCount: tables.length,
            includeWifi: input.includeWifi,
            settingsRevision,
          },
        );
        return this.tableQrPrintBatchView(
          batch,
          new Map(tables.map((table) => [table.tableId, table.tokenVersion])),
          menu.slug,
          new Map([[identityId, author[0]?.displayName ?? "Usuário"]]),
        );
      },
    );
  }

  async markTableQrPrintBatchPrinted(
    identityId: string,
    organizationId: string,
    unitId: string,
    batchId: string,
    idempotencyKey: string,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    return this.idempotentCreate(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "table-qr.print-batch.mark-printed",
      "table_qr_print_batch",
      { batchId },
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`table-qr-print-batch:${organizationId}:${unitId}:${batchId}`}))`,
        );
        const [batch] = await tx
          .select()
          .from(posTableQrPrintBatches)
          .where(
            and(
              eq(posTableQrPrintBatches.organizationId, organizationId),
              eq(posTableQrPrintBatches.unitId, unitId),
              eq(posTableQrPrintBatches.id, batchId),
            ),
          )
          .limit(1);
        if (!batch) throw new NotFoundException({ code: "TABLE_QR_PRINT_BATCH_NOT_FOUND" });
        const tableIds = batch.tablesSnapshot.map((table) => table.tableId);
        const currentTables = tableIds.length
          ? await tx
              .select({
                tableId: posDiningTables.id,
                tokenVersion: posDiningTables.publicAccessVersion,
              })
              .from(posDiningTables)
              .where(
                and(
                  eq(posDiningTables.organizationId, organizationId),
                  eq(posDiningTables.unitId, unitId),
                  eq(posDiningTables.active, true),
                  inArray(posDiningTables.id, tableIds),
                ),
              )
          : [];
        const versions = new Map(currentTables.map((table) => [table.tableId, table.tokenVersion]));
        const [menu] = await tx
          .select({ slug: publicMenus.slug })
          .from(publicMenus)
          .where(
            and(
              eq(publicMenus.organizationId, organizationId),
              eq(publicMenus.unitId, unitId),
              eq(publicMenus.active, true),
            ),
          )
          .limit(1);
        const stale =
          !menu ||
          menu.slug !== batch.menuSlug ||
          batch.tablesSnapshot.some((table) => versions.get(table.tableId) !== table.tokenVersion);
        if (stale) {
          throw new ConflictException({
            code: "TABLE_QR_PRINT_BATCH_STALE",
            message: "Há QR Codes rotacionados neste lote. Gere um novo lote antes de imprimir.",
          });
        }

        let printedBatch = batch;
        if (batch.status !== "printed") {
          const [updated] = await tx
            .update(posTableQrPrintBatches)
            .set({
              status: "printed",
              printedByIdentityId: identityId,
              printedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(posTableQrPrintBatches.organizationId, organizationId),
                eq(posTableQrPrintBatches.unitId, unitId),
                eq(posTableQrPrintBatches.id, batchId),
              ),
            )
            .returning();
          if (!updated) throw new Error("Table QR print batch update did not return a row");
          printedBatch = updated;
          await this.recordChange(
            tx,
            identityId,
            organizationId,
            unitId,
            "pos.table_qr.print_batch_marked_printed",
            "table_qr_print_batch",
            batchId,
            { tableCount: batch.tablesSnapshot.length },
          );
        }
        const actorIds = [
          printedBatch.createdByIdentityId,
          printedBatch.printedByIdentityId,
        ].filter((value): value is string => Boolean(value));
        const actors = await tx
          .select({ id: identities.id, displayName: identities.displayName })
          .from(identities)
          .where(inArray(identities.id, actorIds));
        return this.tableQrPrintBatchView(
          printedBatch,
          versions,
          menu.slug,
          new Map(actors.map((actor) => [actor.id, actor.displayName])),
        );
      },
    );
  }

  async tableQrLifecycle(identityId: string, organizationId: string, unitId: string) {
    await this.requireManager(identityId, organizationId, unitId);
    const [settings, menus, unitRows, brandingRows] = await Promise.all([
      this.getTableQrSettings(identityId, organizationId, unitId),
      this.database.db
        .select({ slug: publicMenus.slug })
        .from(publicMenus)
        .where(
          and(
            eq(publicMenus.organizationId, organizationId),
            eq(publicMenus.unitId, unitId),
            eq(publicMenus.active, true),
          ),
        )
        .limit(1),
      this.database.db
        .select({ name: units.name, timezone: units.timezone })
        .from(units)
        .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
        .limit(1),
      this.database.db
        .select({ config: posCatalogBranding.config })
        .from(posCatalogBranding)
        .where(
          and(
            eq(posCatalogBranding.organizationId, organizationId),
            eq(posCatalogBranding.unitId, unitId),
          ),
        )
        .limit(1),
    ]);
    const menu = menus[0];
    const unit = unitRows[0];
    if (!menu) throw new NotFoundException({ code: "PUBLIC_MENU_NOT_FOUND" });
    if (!unit) throw new NotFoundException({ code: "UNIT_NOT_FOUND" });
    const [tables, batches, rotations] = await Promise.all([
      this.database.db
        .select({
          tableId: posDiningTables.id,
          label: posDiningTables.label,
          tokenVersion: posDiningTables.publicAccessVersion,
          scanCount: posTableQrMetrics.scanCount,
          lastScannedAt: posTableQrMetrics.lastScannedAt,
        })
        .from(posDiningTables)
        .leftJoin(
          posTableQrMetrics,
          and(
            eq(posTableQrMetrics.organizationId, posDiningTables.organizationId),
            eq(posTableQrMetrics.unitId, posDiningTables.unitId),
            eq(posTableQrMetrics.tableId, posDiningTables.id),
          ),
        )
        .where(
          and(
            eq(posDiningTables.organizationId, organizationId),
            eq(posDiningTables.unitId, unitId),
            eq(posDiningTables.active, true),
          ),
        )
        .orderBy(asc(posDiningTables.label), asc(posDiningTables.id)),
      this.database.db
        .select()
        .from(posTableQrPrintBatches)
        .where(
          and(
            eq(posTableQrPrintBatches.organizationId, organizationId),
            eq(posTableQrPrintBatches.unitId, unitId),
          ),
        )
        .orderBy(desc(posTableQrPrintBatches.generatedAt), desc(posTableQrPrintBatches.id)),
      this.database.db
        .select({
          id: auditEvents.id,
          tableId: auditEvents.entityId,
          actorIdentityId: auditEvents.actorIdentityId,
          metadata: auditEvents.metadata,
          occurredAt: auditEvents.occurredAt,
        })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.organizationId, organizationId),
            eq(auditEvents.unitId, unitId),
            eq(auditEvents.action, "pos.table_qr.rotated"),
            eq(auditEvents.entityType, "dining_table"),
          ),
        )
        .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id)),
    ]);
    const identityIds = [
      ...batches.flatMap((batch) => [batch.createdByIdentityId, batch.printedByIdentityId]),
      ...rotations.map((rotation) => rotation.actorIdentityId),
    ].filter((value): value is string => Boolean(value));
    const actors = identityIds.length
      ? await this.database.db
          .select({ id: identities.id, displayName: identities.displayName })
          .from(identities)
          .where(inArray(identities.id, [...new Set(identityIds)]))
      : [];
    const labels = new Map(actors.map((actor) => [actor.id, actor.displayName]));
    const versions = new Map(tables.map((table) => [table.tableId, table.tokenVersion]));
    const presentation = normalizeStoredBranding(brandingRows[0]?.config, unit.name).presentation;
    return {
      settings,
      generalBranding: {
        logoUrl: presentation.logoUrl,
        logoThumbnailUrl: presentation.logoThumbnailUrl,
      },
      presence: {
        mode: settings.presenceProtection,
        code:
          settings.presenceProtection === "daily_code"
            ? tablePresenceCode(tableAccessSecret(), organizationId, unitId, unit.timezone)
            : null,
      },
      tables: tables.map((table) => ({
        tableId: table.tableId,
        label: table.label,
        tokenVersion: table.tokenVersion,
        scanCount: table.scanCount ?? 0,
        lastScannedAt: table.lastScannedAt?.toISOString() ?? null,
        url: this.tableQr(menu.slug, {
          id: table.tableId,
          label: table.label,
          tokenVersion: table.tokenVersion,
        }).url,
      })),
      batches: batches.map((batch) =>
        this.tableQrPrintBatchView(batch, versions, menu.slug, labels),
      ),
      rotations: rotations.flatMap((rotation) => {
        const tokenVersion = rotation.metadata.tokenVersion;
        if (
          !rotation.tableId ||
          !tableQrUuidPattern.test(rotation.tableId) ||
          typeof tokenVersion !== "number" ||
          !Number.isInteger(tokenVersion) ||
          tokenVersion < 1
        ) {
          return [];
        }
        return [
          {
            id: rotation.id,
            tableId: rotation.tableId,
            tokenVersion,
            actorIdentityId: rotation.actorIdentityId,
            actorLabel: rotation.actorIdentityId
              ? (labels.get(rotation.actorIdentityId) ?? "Usuário removido")
              : null,
            occurredAt: rotation.occurredAt.toISOString(),
          },
        ];
      }),
    };
  }

  async testTableQrUrl(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: TestTableQrUrlInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    const [menus, context, settings] = await Promise.all([
      this.database.db
        .select({ slug: publicMenus.slug })
        .from(publicMenus)
        .where(
          and(
            eq(publicMenus.organizationId, organizationId),
            eq(publicMenus.unitId, unitId),
            eq(publicMenus.active, true),
          ),
        )
        .limit(1),
      this.database.db
        .select({ displayName: organizations.tradeName, unitName: units.name })
        .from(units)
        .innerJoin(organizations, eq(organizations.id, units.organizationId))
        .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
        .limit(1),
      this.database.db
        .select({ displayName: posTableQrSettings.displayName })
        .from(posTableQrSettings)
        .where(
          and(
            eq(posTableQrSettings.organizationId, organizationId),
            eq(posTableQrSettings.unitId, unitId),
          ),
        )
        .limit(1),
    ]);
    const menu = menus[0];
    const invalid = (
      reason: "invalid_url" | "invalid_signature" | "table_not_found" | "rotated",
    ) => ({
      valid: false,
      displayName: null,
      unitName: null,
      slug: null,
      tableId: null,
      tableLabel: null,
      tokenVersion: null,
      expiresAt: null,
      reason,
    });
    if (!menu) return invalid("invalid_url");
    const url = new URL(input.url);
    const expectedOrigin = new URL(process.env.CUSTOMER_APP_URL ?? "http://localhost:3101").origin;
    if (
      url.origin !== expectedOrigin ||
      url.pathname !== `/m/${menu.slug}` ||
      url.search ||
      url.username ||
      url.password
    ) {
      return invalid("invalid_url");
    }
    const token = new URLSearchParams(url.hash.slice(1)).get("mesa");
    const claims = token ? verifyTableAccessToken(token, menu.slug, tableAccessSecret()) : null;
    if (!claims) return invalid("invalid_signature");
    const [table] = await this.database.db
      .select({
        tableId: posDiningTables.id,
        tableLabel: posDiningTables.label,
        tokenVersion: posDiningTables.publicAccessVersion,
      })
      .from(posDiningTables)
      .where(
        and(
          eq(posDiningTables.organizationId, organizationId),
          eq(posDiningTables.unitId, unitId),
          eq(posDiningTables.id, claims.tableId),
          eq(posDiningTables.active, true),
        ),
      )
      .limit(1);
    if (!table) return invalid("table_not_found");
    if (table.tokenVersion !== claims.tokenVersion) return invalid("rotated");
    return {
      valid: true,
      displayName: settings[0]?.displayName ?? context[0]?.displayName ?? "Estabelecimento",
      unitName: context[0]?.unitName ?? "Unidade",
      slug: menu.slug,
      tableId: table.tableId,
      tableLabel: table.tableLabel,
      tokenVersion: table.tokenVersion,
      expiresAt: new Date(claims.exp * 1_000).toISOString(),
      reason: null,
    };
  }

  async listTableQr(identityId: string, organizationId: string, unitId: string) {
    await this.requireManager(identityId, organizationId, unitId);
    const [menu] = await this.database.db
      .select({ slug: publicMenus.slug })
      .from(publicMenus)
      .where(
        and(
          eq(publicMenus.organizationId, organizationId),
          eq(publicMenus.unitId, unitId),
          eq(publicMenus.active, true),
        ),
      )
      .limit(1);
    if (!menu) throw new NotFoundException({ code: "PUBLIC_MENU_NOT_FOUND" });
    const tables = await this.database.db
      .select({
        id: posDiningTables.id,
        label: posDiningTables.label,
        tokenVersion: posDiningTables.publicAccessVersion,
      })
      .from(posDiningTables)
      .where(
        and(
          eq(posDiningTables.organizationId, organizationId),
          eq(posDiningTables.unitId, unitId),
          eq(posDiningTables.active, true),
        ),
      )
      .orderBy(asc(posDiningTables.label), asc(posDiningTables.id));
    return tables.map((table) => this.tableQr(menu.slug, table));
  }

  async rotateTableQr(
    identityId: string,
    organizationId: string,
    unitId: string,
    tableId: string,
    idempotencyKey: string,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    return this.idempotentCreate(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "table-qr.rotate",
      "dining_table",
      { tableId },
      async (tx) => {
        const [menu] = await tx
          .select({ slug: publicMenus.slug })
          .from(publicMenus)
          .where(
            and(
              eq(publicMenus.organizationId, organizationId),
              eq(publicMenus.unitId, unitId),
              eq(publicMenus.active, true),
            ),
          )
          .limit(1);
        if (!menu) throw new NotFoundException({ code: "PUBLIC_MENU_NOT_FOUND" });
        const [table] = await tx
          .update(posDiningTables)
          .set({
            publicAccessVersion: sql`${posDiningTables.publicAccessVersion} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(posDiningTables.organizationId, organizationId),
              eq(posDiningTables.unitId, unitId),
              eq(posDiningTables.id, tableId),
              eq(posDiningTables.active, true),
            ),
          )
          .returning({
            id: posDiningTables.id,
            label: posDiningTables.label,
            tokenVersion: posDiningTables.publicAccessVersion,
          });
        if (!table) throw new NotFoundException({ code: "TABLE_NOT_FOUND" });
        await this.recordChange(
          tx,
          identityId,
          organizationId,
          unitId,
          "pos.table_qr.rotated",
          "dining_table",
          tableId,
          { tokenVersion: table.tokenVersion },
        );
        return this.tableQr(menu.slug, table);
      },
    );
  }

  private tableQrSettingsView(
    row: TableQrSettingsRow | undefined,
    fallbackDisplayName: string,
    branding: unknown,
  ): TableQrSettings {
    if (row) {
      return {
        revision: row.revision,
        displayName: row.displayName,
        headline: row.headline,
        instructions: row.instructions,
        logoUrl: row.logoUrl,
        primaryColor: row.primaryColor,
        wifiNotice: row.wifiNotice,
        serviceChargeNotice: row.serviceChargeNotice,
        template: row.template as TableQrSettings["template"],
        presenceProtection: row.presenceProtection as TableQrSettings["presenceProtection"],
        updatedAt: row.updatedAt.toISOString(),
      };
    }
    const presentation = normalizeStoredBranding(branding, fallbackDisplayName).presentation;
    const headline =
      presentation.slogan && presentation.slogan.trim().length >= 2
        ? presentation.slogan.trim().slice(0, 160)
        : "Atendimento direto na sua mesa";
    const wifiNotice = presentation.wifi
      ? `Wi-Fi: ${presentation.wifi.ssid}${presentation.wifi.password ? ` · Senha: ${presentation.wifi.password}` : ""}`.slice(
          0,
          200,
        )
      : null;
    return {
      revision: 0,
      displayName: presentation.displayName.trim().slice(0, 120),
      headline,
      instructions: "Escaneie o QR Code para ver o cardápio e pedir atendimento.",
      logoUrl: presentation.logoUrl,
      primaryColor: presentation.primaryColor,
      wifiNotice,
      serviceChargeNotice: presentation.serviceTaxNotice?.slice(0, 200) ?? null,
      template: "classic",
      presenceProtection: "session_only",
      updatedAt: null,
    };
  }

  private tableQrPrintBatchView(
    batch: TableQrPrintBatchRow,
    currentVersions: Map<string, number>,
    currentMenuSlug: string,
    identityLabels: Map<string, string>,
  ) {
    return {
      id: batch.id,
      format: batch.format,
      output: batch.output,
      template: batch.template,
      status: batch.status,
      menuSlug: batch.menuSlug,
      includeWifi: batch.includeWifi,
      settingsRevision: batch.settingsRevision,
      settings: {
        ...batch.settingsSnapshot,
        presenceProtection: batch.settingsSnapshot.presenceProtection ?? "session_only",
      },
      tables: batch.tablesSnapshot.map((table) => {
        const currentVersion = currentVersions.get(table.tableId) ?? null;
        const isCurrent =
          batch.menuSlug === currentMenuSlug && currentVersion === table.tokenVersion;
        return {
          ...table,
          currentVersion,
          isCurrent,
          url: isCurrent
            ? this.tableQr(currentMenuSlug, {
                id: table.tableId,
                label: table.label,
                tokenVersion: table.tokenVersion,
              }).url
            : null,
        };
      }),
      createdByIdentityId: batch.createdByIdentityId,
      createdByLabel: identityLabels.get(batch.createdByIdentityId) ?? "Usuário removido",
      generatedAt: batch.generatedAt.toISOString(),
      printedByIdentityId: batch.printedByIdentityId,
      printedByLabel: batch.printedByIdentityId
        ? (identityLabels.get(batch.printedByIdentityId) ?? "Usuário removido")
        : null,
      printedAt: batch.printedAt?.toISOString() ?? null,
    };
  }

  private tableQr(slug: string, table: { id: string; label: string; tokenVersion: number }) {
    const token = createTableAccessToken(
      {
        slug,
        tableId: table.id,
        tokenVersion: table.tokenVersion,
        exp: Math.floor(Date.now() / 1_000) + 31_536_000,
      },
      tableAccessSecret(),
    );
    const base = new URL(process.env.CUSTOMER_APP_URL ?? "http://localhost:3101");
    const url = new URL(`/m/${slug}`, base);
    url.hash = `mesa=${encodeURIComponent(token)}`;
    return {
      tableId: table.id,
      label: table.label,
      tokenVersion: table.tokenVersion,
      url: url.toString(),
    };
  }

  private async assertPromotionReferences(
    organizationId: string,
    input: Pick<PromotionInput, "productIds" | "comboIds" | "categoryIds">,
  ) {
    await Promise.all([
      this.assertProductIds(organizationId, input.productIds, "PROMOTION_PRODUCT_NOT_FOUND"),
      this.assertCatalogIds(
        posCombos,
        posCombos.id,
        organizationId,
        input.comboIds,
        "PROMOTION_COMBO_NOT_FOUND",
      ),
      this.assertCatalogIds(
        posCatalogCategories,
        posCatalogCategories.id,
        organizationId,
        input.categoryIds,
        "PROMOTION_CATEGORY_NOT_FOUND",
      ),
    ]);
  }

  private async assertCatalogIds(
    table: typeof posCombos | typeof posCatalogCategories,
    column: typeof posCombos.id | typeof posCatalogCategories.id,
    organizationId: string,
    ids: string[],
    code: string,
  ) {
    if (!ids.length) return;
    const rows = await this.database.db
      .select({ id: column })
      .from(table as typeof posCombos)
      .where(and(eq(table.organizationId, organizationId), inArray(column, [...new Set(ids)])));
    if (rows.length !== new Set(ids).size) throw new NotFoundException({ code });
  }

  private async recordChange(
    tx: Transaction,
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ) {
    await tx
      .insert(auditEvents)
      .values({ organizationId, unitId, actorIdentityId, action, entityType, entityId, metadata });
    await tx.insert(outboxEvents).values({
      topic: "pos.catalog_changed",
      aggregateType: entityType,
      aggregateId: entityId,
      payload: { organizationId, unitId, action, ...metadata },
    });
  }

  private async assertProductIds(organizationId: string, ids: string[], code: string) {
    const unique = [...new Set(ids)];
    if (!unique.length) return;
    const rows = await this.database.db
      .select({ id: posProducts.id })
      .from(posProducts)
      .where(and(eq(posProducts.organizationId, organizationId), inArray(posProducts.id, unique)));
    if (rows.length !== unique.length) throw new NotFoundException({ code });
  }

  private async assertProductReferences(
    organizationId: string,
    unitId: string,
    input: ProductInput,
  ) {
    const [category] = await this.database.db
      .select({ id: posCatalogCategories.id })
      .from(posCatalogCategories)
      .where(
        and(
          eq(posCatalogCategories.organizationId, organizationId),
          eq(posCatalogCategories.id, input.categoryId),
          eq(posCatalogCategories.active, true),
        ),
      )
      .limit(1);
    if (!category) throw new NotFoundException({ code: "CATEGORY_NOT_FOUND" });
    await Promise.all([
      this.assertIds(
        posAllergens,
        posAllergens.id,
        organizationId,
        input.allergenIds,
        "ALLERGEN_NOT_FOUND",
      ),
      this.assertIds(
        posModifierGroups,
        posModifierGroups.id,
        organizationId,
        input.modifierGroupIds,
        "MODIFIER_GROUP_NOT_FOUND",
      ),
      this.assertStations(organizationId, unitId, input.stationIds),
    ]);
  }

  private async assertIds(
    table: typeof posAllergens | typeof posModifierGroups,
    column: typeof posAllergens.id | typeof posModifierGroups.id,
    organizationId: string,
    ids: string[],
    code: string,
  ) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    const rows = await this.database.db
      .select({ id: column })
      .from(table)
      .where(and(eq(table.organizationId, organizationId), inArray(column, unique)));
    if (rows.length !== unique.length) throw new NotFoundException({ code });
  }

  private async lockStationConfiguration(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    stationIds: string[],
  ) {
    for (const stationId of [...new Set(stationIds)].sort()) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`pos-station-config:${organizationId}:${unitId}:${stationId}`}))`,
      );
    }
  }

  private async lockAndAssertStations(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    stationIds: string[],
  ) {
    const unique = [...new Set(stationIds)].sort();
    await this.lockStationConfiguration(tx, organizationId, unitId, unique);
    if (unique.length === 0) return;
    const rows = await tx
      .select({ id: posProductionStations.id })
      .from(posProductionStations)
      .where(
        and(
          eq(posProductionStations.organizationId, organizationId),
          eq(posProductionStations.unitId, unitId),
          inArray(posProductionStations.id, unique),
          eq(posProductionStations.active, true),
        ),
      );
    if (rows.length !== unique.length) {
      throw new ConflictException({ code: "STATION_NOT_ACTIVE" });
    }
  }

  private async assertStations(organizationId: string, unitId: string, stationIds: string[]) {
    const unique = [...new Set(stationIds)];
    const rows = await this.database.db
      .select({ id: posProductionStations.id })
      .from(posProductionStations)
      .where(
        and(
          eq(posProductionStations.organizationId, organizationId),
          eq(posProductionStations.unitId, unitId),
          inArray(posProductionStations.id, unique),
          eq(posProductionStations.active, true),
        ),
      );
    if (rows.length !== unique.length) throw new NotFoundException({ code: "STATION_NOT_FOUND" });
  }
}
