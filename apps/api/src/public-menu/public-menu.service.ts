import type { PublicMenuCommandInput } from "@giromesa/contracts";
import { deviceEnrollments, hubHeartbeats, publicMenus } from "@giromesa/db";
import {
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { and, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { SyncService } from "../sync/sync.service.js";

@Injectable()
export class PublicMenuService {
  constructor(
    private readonly database: DatabaseService,
    private readonly sync: SyncService,
  ) {}

  async menu(slug: string) {
    const menu = await this.resolveMenu(slug);
    return { items: menu.items };
  }

  async hubStatus(slug: string) {
    const menu = await this.resolveMenu(slug);
    return { acknowledged: Boolean(await this.recentHub(menu.organizationId, menu.unitId)) };
  }

  async command(slug: string, idempotencyKey: string, body: PublicMenuCommandInput) {
    const menu = await this.resolveMenu(slug);
    if (Buffer.byteLength(JSON.stringify(body.payload), "utf8") > 65_536) {
      throw new PayloadTooLargeException({
        code: "PUBLIC_COMMAND_TOO_LARGE",
        message: "O comando público excede o limite permitido.",
      });
    }
    const hub = await this.recentHub(menu.organizationId, menu.unitId);
    if (!hub) {
      throw new ServiceUnavailableException({
        code: "PUBLIC_ORDERING_OFFLINE",
        message: "A unidade não está confirmando pedidos digitais neste momento.",
      });
    }
    const command = await this.sync.enqueuePublicCommand({
      organizationId: menu.organizationId,
      unitId: menu.unitId,
      hubId: hub.hubId,
      idempotencyKey,
      type: body.type,
      payload: body.payload,
    });
    const acknowledgement = await this.sync.waitForAcknowledgement(command);
    return { commandId: command.id, expiresAt: command.expiresAt, ...acknowledgement };
  }

  private async resolveMenu(slug: string) {
    const [menu] = await this.database.db
      .select({
        organizationId: publicMenus.organizationId,
        unitId: publicMenus.unitId,
        items: publicMenus.items,
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
