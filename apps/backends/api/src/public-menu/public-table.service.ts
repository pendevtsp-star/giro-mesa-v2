import type {
  PublicMenuCommandInput,
  PublicTableOrderInput,
  PublicTableSessionRequest,
} from "@giromesa/contracts";
import {
  managementSettlementSettings,
  posDiningTableGroupMembers,
  posDiningTableGroups,
  posDiningTables,
  posOrderItems,
  posOrders,
  posTableQrMetrics,
  posTableQrSettings,
  posTabs,
  publicMenus,
  units,
} from "@giromesa/db";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { sessionCookieOptions } from "../auth/session-cookie.js";
import { tablePresenceCode, verifyTablePresenceCode } from "../common/table-presence-code.js";
import { DatabaseService } from "../database/database.module.js";
import { PilotPosService } from "../pilot-operations/pilot-pos.service.js";
import { tabTotals } from "../pilot-operations/pilot-rules.js";
import {
  type TableAccessClaims,
  tableAccessSecret,
  verifyTableAccessToken,
} from "./table-access-token.js";
import {
  createTableSessionToken,
  TABLE_SESSION_TTL_SECONDS,
  type TableSessionClaims,
  verifyTableSessionToken,
} from "./table-session-token.js";

type ActiveMenu = {
  organizationId: string;
  unitId: string;
  timezone: string;
  items: unknown[];
};

@Injectable()
export class PublicTableService {
  constructor(
    private readonly database: DatabaseService,
    private readonly pos: PilotPosService,
  ) {}

  async openSession(
    slug: string,
    tableToken: string | undefined,
    input: PublicTableSessionRequest,
  ) {
    const menu = await this.activeMenu(slug);
    const table = await this.resolveQrTable(menu, slug, tableToken);
    const [settings] = await this.database.db
      .select({ presenceProtection: posTableQrSettings.presenceProtection })
      .from(posTableQrSettings)
      .where(
        and(
          eq(posTableQrSettings.organizationId, menu.organizationId),
          eq(posTableQrSettings.unitId, menu.unitId),
        ),
      )
      .limit(1);
    if (settings?.presenceProtection === "daily_code") {
      const expected = tablePresenceCode(
        tableAccessSecret(),
        menu.organizationId,
        menu.unitId,
        menu.timezone,
      );
      if (!verifyTablePresenceCode(expected, input.presenceCode)) {
        throw new ForbiddenException({
          code: "PUBLIC_TABLE_PRESENCE_CODE_REQUIRED",
          message: "Informe o código de presença disponível no estabelecimento.",
          tableLabel: table.label,
        });
      }
    }
    const scannedAt = new Date();
    await this.database.db
      .insert(posTableQrMetrics)
      .values({
        organizationId: menu.organizationId,
        unitId: menu.unitId,
        tableId: table.id,
        scanCount: 1,
        lastScannedAt: scannedAt,
      })
      .onConflictDoUpdate({
        target: [
          posTableQrMetrics.organizationId,
          posTableQrMetrics.unitId,
          posTableQrMetrics.tableId,
        ],
        set: {
          scanCount: sql`${posTableQrMetrics.scanCount} + 1`,
          lastScannedAt: scannedAt,
          updatedAt: scannedAt,
        },
      });
    const tab = await this.activeTabForTable(menu, table.id);
    const expiresAt = new Date(Date.now() + TABLE_SESSION_TTL_SECONDS * 1_000);
    const token = createTableSessionToken(
      {
        slug,
        organizationId: menu.organizationId,
        unitId: menu.unitId,
        tableId: table.id,
        ...(tab ? { tabId: tab.id } : {}),
        tokenVersion: table.tokenVersion,
        exp: Math.floor(expiresAt.getTime() / 1_000),
      },
      tableAccessSecret(),
    );
    return {
      token,
      cookieOptions: sessionCookieOptions(expiresAt),
      response: {
        status: tab ? ("active" as const) : ("awaiting_tab" as const),
        activeTab: Boolean(tab),
        tableLabel: table.label,
        expiresAt: expiresAt.toISOString(),
      },
    };
  }

  async status(slug: string, sessionToken: string | undefined) {
    const { claims, menu, table, tab } = await this.requireSession(slug, sessionToken);
    const expiresAt = new Date(claims.exp * 1_000);
    const response = {
      status: tab ? ("active" as const) : ("awaiting_tab" as const),
      activeTab: Boolean(tab),
      tableLabel: table.label,
      expiresAt: expiresAt.toISOString(),
    };
    if (claims.tabId || !tab) return { response };

    return {
      token: createTableSessionToken(
        {
          slug,
          organizationId: menu.organizationId,
          unitId: menu.unitId,
          tableId: table.id,
          tabId: tab.id,
          tokenVersion: table.tokenVersion,
          exp: claims.exp,
        },
        tableAccessSecret(),
      ),
      cookieOptions: sessionCookieOptions(expiresAt),
      response,
    };
  }

  async command(
    slug: string,
    idempotencyKey: string,
    tableToken: string | undefined,
    sessionToken: string | undefined,
    body: PublicMenuCommandInput,
  ) {
    const session = sessionToken ? await this.requireSession(slug, sessionToken) : null;
    if (body.type === "request_check" && !session) this.invalidSession();
    const menu = session?.menu ?? (await this.activeMenu(slug));
    const table = session?.table ?? (await this.resolveQrTable(menu, slug, tableToken));
    const tab = session?.tab ?? (await this.activeTabForTable(menu, table.id));
    if (body.type === "request_check" && !tab) {
      throw new ConflictException({
        code: "PUBLIC_TABLE_TAB_NOT_OPEN",
        message: "Não existe uma comanda aberta para pedir a conta.",
      });
    }
    const result = await this.pos.createPublicServiceCall(
      menu.organizationId,
      menu.unitId,
      table.id,
      tab?.id,
      idempotencyKey,
      body.type === "request_check" ? "bill" : "assistance",
    );
    return {
      acknowledged: true as const,
      callId: result.call.id,
      kind: result.call.kind,
      status: result.call.status,
      duplicate: result.duplicate || result.idempotentReplay === true,
    };
  }

  async consumption(slug: string, sessionToken: string | undefined) {
    const { menu, table, tab: currentTab } = await this.requireSession(slug, sessionToken);
    const tab = this.requireActiveTab(currentTab);
    const [items, [settings]] = await Promise.all([
      this.database.db
        .select({
          name: posOrderItems.productName,
          quantity: posOrderItems.quantity,
          grossCents: posOrderItems.grossCents,
          discountCents: posOrderItems.discountCents,
          totalCents: posOrderItems.netCents,
        })
        .from(posOrderItems)
        .innerJoin(
          posOrders,
          and(
            eq(posOrders.organizationId, posOrderItems.organizationId),
            eq(posOrders.unitId, posOrderItems.unitId),
            eq(posOrders.id, posOrderItems.orderId),
          ),
        )
        .where(
          and(
            eq(posOrderItems.organizationId, menu.organizationId),
            eq(posOrderItems.unitId, menu.unitId),
            eq(posOrders.tabId, tab.id),
            ne(posOrders.status, "draft"),
            ne(posOrders.status, "canceled"),
            ne(posOrderItems.status, "canceled"),
          ),
        ),
      this.database.db
        .select({ configuration: managementSettlementSettings.configuration })
        .from(managementSettlementSettings)
        .where(
          and(
            eq(managementSettlementSettings.organizationId, menu.organizationId),
            eq(managementSettlementSettings.unitId, menu.unitId),
          ),
        )
        .limit(1),
    ]);
    const totals = tabTotals(
      items,
      tab.serviceChargeBasisPoints,
      tab.tipCents,
      settings?.configuration.serviceBase ?? "net_after_discounts",
    );
    return {
      status: "open" as const,
      tableLabel: table.label,
      items: items.map(({ name, quantity, totalCents }) => ({ name, quantity, totalCents })),
      subtotalCents: totals.subtotalCents,
      totalCents: totals.totalCents,
    };
  }

  async createOrder(
    slug: string,
    sessionToken: string | undefined,
    idempotencyKey: string,
    input: PublicTableOrderInput,
  ) {
    const { menu, table, tab: currentTab } = await this.requireSession(slug, sessionToken);
    const tab = this.requireActiveTab(currentTab);
    const publishedProductIds = new Set(
      menu.items.flatMap((item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { id?: unknown }).id === "string"
          ? [(item as { id: string }).id]
          : [],
      ),
    );
    if (input.items.some((item) => !publishedProductIds.has(item.productId))) {
      throw new BadRequestException({
        code: "PUBLIC_PRODUCT_NOT_IN_MENU",
        message: "Um item não pertence ao cardápio publicado.",
      });
    }
    const result = await this.pos.createPublicTableOrder(
      menu.organizationId,
      menu.unitId,
      table.id,
      tab.id,
      idempotencyKey,
      input,
    );
    return this.orderView(result.order, result.items, result.idempotentReplay === true);
  }

  async order(slug: string, sessionToken: string | undefined, orderId: string) {
    const { menu, tab: currentTab } = await this.requireSession(slug, sessionToken);
    const tab = this.requireActiveTab(currentTab);
    const [order] = await this.database.db
      .select()
      .from(posOrders)
      .where(
        and(
          eq(posOrders.organizationId, menu.organizationId),
          eq(posOrders.unitId, menu.unitId),
          eq(posOrders.id, orderId),
          eq(posOrders.tabId, tab.id),
          eq(posOrders.source, "qr_table"),
        ),
      )
      .limit(1);
    if (!order) throw new NotFoundException({ code: "PUBLIC_TABLE_ORDER_NOT_FOUND" });
    const items = await this.database.db
      .select()
      .from(posOrderItems)
      .where(
        and(
          eq(posOrderItems.organizationId, menu.organizationId),
          eq(posOrderItems.unitId, menu.unitId),
          eq(posOrderItems.orderId, order.id),
        ),
      );
    return this.orderView(order, items, false);
  }

  private orderView(
    order: typeof posOrders.$inferSelect,
    items: (typeof posOrderItems.$inferSelect)[],
    idempotentReplay: boolean,
  ) {
    return {
      orderId: order.id,
      status: order.status,
      source: "qr_table" as const,
      items: items.map((item) => ({
        name: item.productName,
        quantity: item.quantity,
        totalCents: item.netCents,
      })),
      totalCents: items.reduce((total, item) => total + item.netCents, 0),
      ...(idempotentReplay ? { idempotentReplay: true } : {}),
    };
  }

  private async requireSession(slug: string, token: string | undefined) {
    let claims: TableSessionClaims | null = null;
    try {
      claims = token ? verifyTableSessionToken(token, slug, tableAccessSecret()) : null;
    } catch {
      this.sessionUnavailable();
    }
    if (!claims) this.invalidSession();
    const menu = await this.activeMenu(slug);
    if (claims.organizationId !== menu.organizationId || claims.unitId !== menu.unitId) {
      this.invalidSession();
    }
    const table = await this.resolveSessionTable(menu, claims);
    const tab = await this.activeTabForTable(menu, table.id);
    if (claims.tabId && (!tab || tab.id !== claims.tabId)) this.invalidSession();
    return { claims, menu, table, tab };
  }

  private requireActiveTab(tab: typeof posTabs.$inferSelect | null) {
    if (!tab) {
      throw new ConflictException({
        code: "PUBLIC_TABLE_TAB_NOT_OPEN",
        message: "A mesa ainda não possui uma comanda aberta.",
      });
    }
    return tab;
  }

  private async resolveSessionTable(menu: ActiveMenu, claims: TableSessionClaims) {
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
    if (!table || table.tokenVersion !== claims.tokenVersion) this.invalidSession();
    return table;
  }

  private async resolveQrTable(menu: ActiveMenu, slug: string, token: string | undefined) {
    let claims: TableAccessClaims | null = null;
    try {
      claims = token ? verifyTableAccessToken(token, slug, tableAccessSecret()) : null;
    } catch {
      this.sessionUnavailable();
    }
    if (!claims) this.invalidQr();
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
    if (!table || table.tokenVersion !== claims.tokenVersion) this.invalidQr();
    return table;
  }

  private async activeTabForTable(menu: ActiveMenu, tableId: string) {
    const [direct] = await this.database.db
      .select()
      .from(posTabs)
      .where(
        and(
          eq(posTabs.organizationId, menu.organizationId),
          eq(posTabs.unitId, menu.unitId),
          eq(posTabs.tableId, tableId),
          eq(posTabs.status, "open"),
        ),
      )
      .limit(1);
    if (direct) return direct;
    const [grouped] = await this.database.db
      .select({ tab: posTabs })
      .from(posDiningTableGroupMembers)
      .innerJoin(
        posDiningTableGroups,
        and(
          eq(posDiningTableGroups.organizationId, posDiningTableGroupMembers.organizationId),
          eq(posDiningTableGroups.unitId, posDiningTableGroupMembers.unitId),
          eq(posDiningTableGroups.id, posDiningTableGroupMembers.groupId),
          eq(posDiningTableGroups.mode, "single_tab"),
          isNull(posDiningTableGroups.dissolvedAt),
          isNotNull(posDiningTableGroups.primaryTabId),
        ),
      )
      .innerJoin(
        posTabs,
        and(
          eq(posTabs.organizationId, posDiningTableGroups.organizationId),
          eq(posTabs.unitId, posDiningTableGroups.unitId),
          eq(posTabs.id, posDiningTableGroups.primaryTabId),
          eq(posTabs.status, "open"),
        ),
      )
      .where(
        and(
          eq(posDiningTableGroupMembers.organizationId, menu.organizationId),
          eq(posDiningTableGroupMembers.unitId, menu.unitId),
          eq(posDiningTableGroupMembers.tableId, tableId),
        ),
      )
      .limit(1);
    return grouped?.tab ?? null;
  }

  private async activeMenu(slug: string): Promise<ActiveMenu> {
    const [menu] = await this.database.db
      .select({
        organizationId: publicMenus.organizationId,
        unitId: publicMenus.unitId,
        timezone: units.timezone,
        items: publicMenus.items,
      })
      .from(publicMenus)
      .innerJoin(
        units,
        and(eq(units.organizationId, publicMenus.organizationId), eq(units.id, publicMenus.unitId)),
      )
      .where(
        and(
          eq(publicMenus.slug, slug),
          eq(publicMenus.active, true),
          sql`${publicMenus.publishedAt} is not null`,
          eq(units.active, true),
        ),
      )
      .limit(1);
    if (!menu) throw new NotFoundException({ code: "PUBLIC_MENU_NOT_FOUND" });
    return menu;
  }

  private invalidQr(): never {
    throw new UnauthorizedException({
      code: "PUBLIC_TABLE_ACCESS_INVALID",
      message: "Leia novamente o QR Code disponível na mesa.",
    });
  }

  private invalidSession(): never {
    throw new UnauthorizedException({
      code: "PUBLIC_TABLE_SESSION_INVALID",
      message: "Leia novamente o QR Code disponível na mesa.",
    });
  }

  private sessionUnavailable(): never {
    throw new ServiceUnavailableException({
      code: "PUBLIC_TABLE_ACCESS_NOT_CONFIGURED",
      message: "O atendimento por QR não está configurado nesta unidade.",
    });
  }
}
