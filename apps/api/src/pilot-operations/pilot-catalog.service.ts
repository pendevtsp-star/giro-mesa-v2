import {
  auditEvents,
  outboxEvents,
  posAllergens,
  posCatalogCategories,
  posModifierGroups,
  posModifierOptions,
  posProductAllergens,
  posProductAvailability,
  posProductionStations,
  posProductModifierGroups,
  posProductPrices,
  posProductStations,
  posProducts,
  posRecipeComponents,
} from "@giromesa/db";
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import type {
  AllergenInput,
  CategoryInput,
  ModifierGroupInput,
  ProductInput,
  ProductUnitConfigInput,
  StationInput,
} from "./pilot-schemas.js";

@Injectable()
export class PilotCatalogService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
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

  async list(identityId: string, organizationId: string, unitId: string) {
    await this.requireAccess(identityId, organizationId, unitId);
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
      availability,
      stations,
      productStations,
    };
  }

  async createCategory(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: CategoryInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    const [category] = await this.database.db
      .insert(posCatalogCategories)
      .values({ organizationId, ...input })
      .returning();
    return category;
  }

  async createAllergen(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: AllergenInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    const [allergen] = await this.database.db
      .insert(posAllergens)
      .values({ organizationId, ...input })
      .returning();
    return allergen;
  }

  async createModifierGroup(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: ModifierGroupInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    return this.database.db.transaction(async (tx) => {
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
      const options = await tx
        .insert(posModifierOptions)
        .values(input.options.map((option) => ({ organizationId, groupId: group.id, ...option })))
        .returning();
      return { ...group, options };
    });
  }

  async createStation(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: StationInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    const [station] = await this.database.db
      .insert(posProductionStations)
      .values({ organizationId, unitId, ...input })
      .returning();
    return station;
  }

  async createProduct(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: ProductInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    await this.assertProductReferences(organizationId, unitId, input);
    return this.database.db.transaction(async (tx) => {
      const [product] = await tx
        .insert(posProducts)
        .values({
          organizationId,
          categoryId: input.categoryId,
          sku: input.sku,
          name: input.name,
          description: input.description,
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
      });
      await tx.insert(posProductAvailability).values({
        organizationId,
        unitId,
        productId: product.id,
        available: input.available,
        schedule: input.availabilitySchedule,
      });
      await tx.insert(posProductStations).values(
        [...new Set(input.stationIds)].map((stationId) => ({
          organizationId,
          unitId,
          productId: product.id,
          stationId,
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
        organizationId,
        unitId,
        topic: "pos.catalog_changed",
        aggregateType: "product",
        aggregateId: product.id,
        payload: { organizationId, unitId, productId: product.id, action: "created" },
      });
      return product;
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
    await this.database.db.transaction(async (tx) => {
      await tx
        .insert(posProductPrices)
        .values({ organizationId, unitId, productId, priceCents: input.priceCents })
        .onConflictDoUpdate({
          target: [posProductPrices.unitId, posProductPrices.productId],
          set: { priceCents: input.priceCents, updatedAt: new Date() },
        });
      await tx
        .insert(posProductAvailability)
        .values({
          organizationId,
          unitId,
          productId,
          available: input.available,
          schedule: input.availabilitySchedule,
        })
        .onConflictDoUpdate({
          target: [posProductAvailability.unitId, posProductAvailability.productId],
          set: {
            available: input.available,
            schedule: input.availabilitySchedule,
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
        organizationId,
        unitId,
        topic: "pos.catalog_changed",
        aggregateType: "product",
        aggregateId: productId,
        payload: { organizationId, unitId, productId, action: "unit_configured" },
      });
    });
    return { productId, ...input };
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
