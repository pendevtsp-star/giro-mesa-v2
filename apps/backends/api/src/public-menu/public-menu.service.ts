import {
  deviceEnrollments,
  hubHeartbeats,
  posModifierGroups,
  posModifierOptions,
  posProductAvailability,
  posProductModifierGroups,
  posProductPrices,
  posProducts,
  publicMenus,
  units,
} from "@giromesa/db";
import { Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { isWithinAvailability, projectKdsAvailability } from "../pilot-operations/pilot-rules.js";
import { publicMenuItems } from "./public-menu-snapshot.js";
import { localDate } from "./public-order-rules.js";

@Injectable()
export class PublicMenuService {
  constructor(private readonly database: DatabaseService) {}

  async menu(slug: string) {
    const menu = await this.resolveMenu(slug);
    // Publication controls which products are public; operational prices and pauses are live.
    const items = publicMenuItems(menu.items, menu.metadata);
    const productIds = items.map((item) => String(item.id));
    if (!productIds.length) return { items, metadata: menu.metadata, version: menu.version };
    const [products, modifiers] = await Promise.all([
      this.database.db
        .select({
          id: posProducts.id,
          active: posProducts.active,
          priceCents: posProductPrices.priceCents,
          deliveryPriceCents: posProductPrices.deliveryPriceCents,
          available: posProductAvailability.available,
          schedule: posProductAvailability.schedule,
          dailyStock: posProductAvailability.dailyStock,
          soldToday: posProductAvailability.soldToday,
          stockDate: posProductAvailability.stockDate,
          resetAt: posProductAvailability.operationalResetAt,
          reason: posProductAvailability.operationalReason,
        })
        .from(posProducts)
        .innerJoin(
          posProductPrices,
          and(
            eq(posProductPrices.organizationId, menu.organizationId),
            eq(posProductPrices.unitId, menu.unitId),
            eq(posProductPrices.productId, posProducts.id),
          ),
        )
        .innerJoin(
          posProductAvailability,
          and(
            eq(posProductAvailability.organizationId, menu.organizationId),
            eq(posProductAvailability.unitId, menu.unitId),
            eq(posProductAvailability.productId, posProducts.id),
          ),
        )
        .where(
          and(
            eq(posProducts.organizationId, menu.organizationId),
            inArray(posProducts.id, productIds),
          ),
        ),
      this.database.db
        .select({
          productId: posProductModifierGroups.productId,
          groupId: posModifierGroups.id,
          groupName: posModifierGroups.name,
          minimum: posModifierGroups.minimumSelections,
          maximum: posModifierGroups.maximumSelections,
          optionId: posModifierOptions.id,
          optionName: posModifierOptions.name,
          priceCents: posModifierOptions.priceDeltaCents,
        })
        .from(posProductModifierGroups)
        .innerJoin(
          posModifierGroups,
          and(
            eq(posModifierGroups.organizationId, menu.organizationId),
            eq(posModifierGroups.id, posProductModifierGroups.groupId),
            eq(posModifierGroups.active, true),
          ),
        )
        .leftJoin(
          posModifierOptions,
          and(
            eq(posModifierOptions.organizationId, menu.organizationId),
            eq(posModifierOptions.groupId, posModifierGroups.id),
            eq(posModifierOptions.active, true),
          ),
        )
        .where(
          and(
            eq(posProductModifierGroups.organizationId, menu.organizationId),
            inArray(posProductModifierGroups.productId, productIds),
          ),
        ),
    ]);
    const byProduct = new Map(products.map((product) => [product.id, product]));
    const now = new Date();
    const stockDate = localDate(now, menu.timezone);
    return {
      items: items.map((item): Record<string, unknown> => {
        const product = byProduct.get(String(item.id));
        if (!product) return { ...item, available: false };
        const rows = modifiers.filter((row) => row.productId === item.id);
        const groups = [...new Map(rows.map((row) => [row.groupId, row])).values()];
        return {
          ...item,
          priceCents: product.priceCents,
          deliveryPriceCents: product.deliveryPriceCents ?? product.priceCents,
          available:
            product.active &&
            projectKdsAvailability(product, stockDate, now).available &&
            isWithinAvailability(product.schedule, now, menu.timezone),
          modifierGroups: groups.map((group) => ({
            id: group.groupId,
            name: group.groupName,
            required: group.minimum > 0,
            maxSelections: group.maximum,
            options: rows
              .filter((row) => row.groupId === group.groupId && row.optionId !== null)
              .map((row) => ({
                id: row.optionId,
                name: row.optionName,
                priceCents: row.priceCents,
              })),
          })),
        };
      }),
      metadata: menu.metadata,
      version: menu.version,
    };
  }

  async hubStatus(slug: string) {
    const menu = await this.resolveMenu(slug);
    return { acknowledged: Boolean(await this.recentHub(menu.organizationId, menu.unitId)) };
  }

  private async resolveMenu(slug: string) {
    const [menu] = await this.database.db
      .select({
        organizationId: publicMenus.organizationId,
        unitId: publicMenus.unitId,
        items: publicMenus.items,
        metadata: publicMenus.metadata,
        version: publicMenus.version,
        timezone: units.timezone,
      })
      .from(publicMenus)
      .innerJoin(
        units,
        and(eq(units.id, publicMenus.unitId), eq(units.organizationId, publicMenus.organizationId)),
      )
      .where(
        and(
          eq(publicMenus.slug, slug),
          eq(publicMenus.active, true),
          isNotNull(publicMenus.publishedAt),
        ),
      )
      .limit(1);
    if (!menu)
      throw new NotFoundException({
        code: "PUBLIC_MENU_NOT_FOUND",
        message: "Cardápio não encontrado.",
      });
    return menu;
  }

  private async recentHub(organizationId: string, unitId: string) {
    const cutoff = new Date(Date.now() - 30_000);
    const [heartbeat] = await this.database.db
      .select({ hubId: hubHeartbeats.hubId, lastSeenAt: hubHeartbeats.lastSeenAt })
      .from(hubHeartbeats)
      .innerJoin(
        deviceEnrollments,
        and(
          eq(deviceEnrollments.id, hubHeartbeats.hubId),
          eq(deviceEnrollments.organizationId, hubHeartbeats.organizationId),
          eq(deviceEnrollments.unitId, hubHeartbeats.unitId),
        ),
      )
      .where(
        and(
          eq(hubHeartbeats.organizationId, organizationId),
          eq(hubHeartbeats.unitId, unitId),
          gt(hubHeartbeats.lastSeenAt, cutoff),
          isNull(deviceEnrollments.revokedAt),
        ),
      )
      .limit(1);
    return heartbeat;
  }
}
