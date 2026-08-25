import { deviceEnrollments, hubHeartbeats, publicMenus } from "@giromesa/db";
import { Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { publicMenuItems } from "./public-menu-snapshot.js";

@Injectable()
export class PublicMenuService {
  constructor(private readonly database: DatabaseService) {}

  async menu(slug: string) {
    const menu = await this.resolveMenu(slug);
    return {
      items: publicMenuItems(menu.items, menu.metadata),
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
      })
      .from(publicMenus)
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
