import type { PublicMenuCommandInput } from "@giromesa/contracts";
import { deviceEnrollments, hubHeartbeats, posDiningTables, publicMenus } from "@giromesa/db";
import {
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { and, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { SyncService } from "../sync/sync.service.js";
import { publicMenuItems } from "./public-menu-snapshot.js";
import {
  type TableAccessClaims,
  tableAccessSecret,
  verifyTableAccessToken,
} from "./table-access-token.js";

@Injectable()
export class PublicMenuService {
  constructor(
    private readonly database: DatabaseService,
    private readonly sync: SyncService,
  ) {}

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

  async command(
    slug: string,
    idempotencyKey: string,
    tableToken: string | undefined,
    body: PublicMenuCommandInput,
  ) {
    const menu = await this.resolveMenu(slug);
    if (Buffer.byteLength(JSON.stringify(body.payload), "utf8") > 65_536) {
      throw new PayloadTooLargeException({
        code: "PUBLIC_COMMAND_TOO_LARGE",
        message: "O comando público excede o limite permitido.",
      });
    }
    const table =
      body.type === "call_waiter" || body.type === "request_check"
        ? await this.resolveTable(menu, slug, tableToken)
        : null;
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
      payload: table
        ? { ...body.payload, tableId: table.id, tableLabel: table.label }
        : body.payload,
    });
    const acknowledgement = await this.sync.waitForAcknowledgement(command);
    return { commandId: command.id, expiresAt: command.expiresAt, ...acknowledgement };
  }

  private async resolveTable(
    menu: { organizationId: string; unitId: string },
    slug: string,
    token: string | undefined,
  ) {
    let claims: TableAccessClaims | null = null;
    try {
      claims = token ? verifyTableAccessToken(token, slug, tableAccessSecret()) : null;
    } catch {
      throw new ServiceUnavailableException({
        code: "PUBLIC_TABLE_ACCESS_NOT_CONFIGURED",
        message: "O atendimento por QR não está configurado nesta unidade.",
      });
    }
    if (!claims) this.invalidTableToken();
    const [table] = await this.database.db
      .select({
        id: posDiningTables.id,
        label: posDiningTables.label,
        tokenVersion: posDiningTables.publicAccessVersion,
      })
      .from(posDiningTables)
      .where(
        and(
          eq(posDiningTables.organizationId, menu.organizationId),
          eq(posDiningTables.unitId, menu.unitId),
          eq(posDiningTables.id, claims.tableId),
          eq(posDiningTables.active, true),
        ),
      )
      .limit(1);
    if (!table || table.tokenVersion !== claims.tokenVersion) this.invalidTableToken();
    return table;
  }

  private invalidTableToken(): never {
    throw new UnauthorizedException({
      code: "PUBLIC_TABLE_ACCESS_INVALID",
      message: "Leia novamente o QR Code disponível na mesa.",
    });
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
