import { randomUUID } from "node:crypto";
import {
  auditEvents,
  type Database,
  memberships,
  organizations,
  outboxEvents,
  posDiningRooms,
  posDiningTables,
  posIdempotencyReceipts,
  posKdsTicketItems,
  posKdsTickets,
  posManagerPins,
  posModifierGroups,
  posModifierOptions,
  posOperationApprovals,
  posOrderItemModifiers,
  posOrderItems,
  posOrders,
  posProductAvailability,
  posProductModifierGroups,
  posProductPrices,
  posProductStations,
  posProducts,
  posTabEvents,
  posTabs,
  roleBindings,
  units,
} from "@giromesa/db";
import { billingAccess } from "@giromesa/domain";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import {
  assertKdsTransition,
  assertTenantScope,
  isWithinAvailability,
  itemAmounts,
  type KdsState,
  replayResult,
  requestHash,
  tabTotals,
} from "./pilot-rules.js";
import type {
  CancelItemInput,
  DiscountInput,
  KdsStateInput,
  ManagerPinInput,
  MergeTabsInput,
  OpenTabInput,
  OrderInput,
  RoomInput,
  ServiceChargeInput,
  SplitTabInput,
  TableInput,
  TipInput,
  TransferTabInput,
} from "./pilot-schemas.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type JsonResponse = Record<string, unknown>;

@Injectable()
export class PilotPosService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
  ) {}

  private async requireAccess(identityId: string, organizationId: string, unitId: string) {
    return this.scope.requireUnitAccess(identityId, organizationId, unitId);
  }

  private async requireScopedRole(
    identityId: string,
    organizationId: string,
    unitId: string,
    allowed: readonly ("owner" | "manager" | "waiter" | "cashier" | "kds")[],
  ) {
    await this.requireAccess(identityId, organizationId, unitId);
    const rows = await this.scope.requireOrganizationRole(identityId, organizationId, allowed);
    if (
      !rows.some(
        (row) =>
          allowed.some((allowedRole) => allowedRole === row.role) &&
          (row.unitId === null || row.unitId === unitId),
      )
    ) {
      throw new ForbiddenException({
        code: "POS_ROLE_DENIED",
        message: "Ação não autorizada nesta unidade.",
      });
    }
  }

  private async requireOperationalBilling(organizationId: string) {
    const [organization] = await this.database.db
      .select({
        state: organizations.billingState,
        operationalClosureUntil: organizations.operationalClosureUntil,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!organization) throw new NotFoundException();
    if (
      billingAccess(organization.state, new Date(), organization.operationalClosureUntil) !== "full"
    ) {
      throw new HttpException(
        {
          code: "OPERATION_RESTRICTED",
          message: "Novas operações estão bloqueadas pela situação comercial da conta.",
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  async listFloor(identityId: string, organizationId: string, unitId: string) {
    await this.requireAccess(identityId, organizationId, unitId);
    const [rooms, tables, tabs] = await Promise.all([
      this.database.db
        .select()
        .from(posDiningRooms)
        .where(
          and(eq(posDiningRooms.organizationId, organizationId), eq(posDiningRooms.unitId, unitId)),
        ),
      this.database.db
        .select()
        .from(posDiningTables)
        .where(
          and(
            eq(posDiningTables.organizationId, organizationId),
            eq(posDiningTables.unitId, unitId),
          ),
        ),
      this.database.db
        .select()
        .from(posTabs)
        .where(
          and(
            eq(posTabs.organizationId, organizationId),
            eq(posTabs.unitId, unitId),
            eq(posTabs.status, "open"),
          ),
        ),
    ]);
    return { rooms, tables, openTabs: tabs };
  }

  async createRoom(identityId: string, organizationId: string, unitId: string, input: RoomInput) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager"]);
    const [room] = await this.database.db
      .insert(posDiningRooms)
      .values({ organizationId, unitId, ...input })
      .returning();
    return room;
  }

  async createTable(
    identityId: string,
    organizationId: string,
    unitId: string,
    roomId: string,
    input: TableInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager"]);
    const [room] = await this.database.db
      .select({ id: posDiningRooms.id })
      .from(posDiningRooms)
      .where(
        and(
          eq(posDiningRooms.organizationId, organizationId),
          eq(posDiningRooms.unitId, unitId),
          eq(posDiningRooms.id, roomId),
          eq(posDiningRooms.active, true),
        ),
      )
      .limit(1);
    if (!room) throw new NotFoundException({ code: "ROOM_NOT_FOUND" });
    const [table] = await this.database.db
      .insert(posDiningTables)
      .values({ organizationId, unitId, roomId, ...input })
      .returning();
    return table;
  }

  async setManagerPin(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: ManagerPinInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager"]);
    const [membership] = await this.database.db
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
      .where(
        and(
          eq(memberships.identityId, identityId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          inArray(roleBindings.role, ["owner", "manager"]),
          or(isNull(roleBindings.unitId), eq(roleBindings.unitId, unitId)),
        ),
      )
      .limit(1);
    if (!membership) throw new ForbiddenException({ code: "MANAGER_PIN_DENIED" });
    const pinHash = await argon2.hash(input.pin, { type: argon2.argon2id });
    await this.database.db
      .insert(posManagerPins)
      .values({ membershipId: membership.id, organizationId, pinHash })
      .onConflictDoUpdate({
        target: posManagerPins.membershipId,
        set: { pinHash, active: true, updatedAt: new Date() },
      });
    await this.database.db.insert(auditEvents).values({
      organizationId,
      unitId,
      actorIdentityId: identityId,
      action: "pos.manager_pin.updated",
      entityType: "membership",
      entityId: membership.id,
    });
    return { configured: true };
  }

  async listTabs(identityId: string, organizationId: string, unitId: string) {
    await this.requireAccess(identityId, organizationId, unitId);
    return this.database.db
      .select()
      .from(posTabs)
      .where(and(eq(posTabs.organizationId, organizationId), eq(posTabs.unitId, unitId)));
  }

  async getTab(identityId: string, organizationId: string, unitId: string, tabId: string) {
    await this.requireAccess(identityId, organizationId, unitId);
    const [tab] = await this.database.db
      .select()
      .from(posTabs)
      .where(
        and(
          eq(posTabs.organizationId, organizationId),
          eq(posTabs.unitId, unitId),
          eq(posTabs.id, tabId),
        ),
      )
      .limit(1);
    if (!tab) throw new NotFoundException({ code: "TAB_NOT_FOUND" });
    const orders = await this.database.db
      .select()
      .from(posOrders)
      .where(
        and(
          eq(posOrders.organizationId, organizationId),
          eq(posOrders.unitId, unitId),
          eq(posOrders.tabId, tabId),
        ),
      );
    const orderIds = orders.map((order) => order.id);
    const items =
      orderIds.length === 0
        ? []
        : await this.database.db
            .select()
            .from(posOrderItems)
            .where(
              and(
                eq(posOrderItems.organizationId, organizationId),
                eq(posOrderItems.unitId, unitId),
                inArray(posOrderItems.orderId, orderIds),
              ),
            );
    const itemIds = items.map((item) => item.id);
    const modifiers =
      itemIds.length === 0
        ? []
        : await this.database.db
            .select()
            .from(posOrderItemModifiers)
            .where(
              and(
                eq(posOrderItemModifiers.organizationId, organizationId),
                eq(posOrderItemModifiers.unitId, unitId),
                inArray(posOrderItemModifiers.orderItemId, itemIds),
              ),
            );
    return { tab, orders, items, modifiers };
  }

  async openTab(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: OpenTabInput,
    offlineIds?: { tabId: string },
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "waiter",
      "cashier",
    ]);
    await this.requireOperationalBilling(organizationId);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "tab.open",
      input,
      async (tx) => {
        if (input.tableId) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`pos-table:${organizationId}:${unitId}:${input.tableId}`}))`,
          );
          const [table] = await tx
            .select({ id: posDiningTables.id, status: posDiningTables.status })
            .from(posDiningTables)
            .where(
              and(
                eq(posDiningTables.organizationId, organizationId),
                eq(posDiningTables.unitId, unitId),
                eq(posDiningTables.id, input.tableId),
                eq(posDiningTables.active, true),
              ),
            )
            .limit(1);
          if (!table) throw new NotFoundException({ code: "TABLE_NOT_FOUND" });
          const [occupied] = await tx
            .select({ id: posTabs.id })
            .from(posTabs)
            .where(
              and(
                eq(posTabs.organizationId, organizationId),
                eq(posTabs.unitId, unitId),
                eq(posTabs.tableId, input.tableId),
                eq(posTabs.status, "open"),
              ),
            )
            .limit(1);
          if (occupied) throw new ConflictException({ code: "TABLE_OCCUPIED", tabId: occupied.id });
        }
        const [tab] = await tx
          .insert(posTabs)
          .values({
            ...(offlineIds ? { id: offlineIds.tabId } : {}),
            organizationId,
            unitId,
            tableId: input.tableId,
            label: input.label,
            guestCount: input.guestCount,
            openedByIdentityId: identityId,
          })
          .returning();
        if (!tab) throw new Error("Tab insert did not return a row");
        if (input.tableId) {
          await tx
            .update(posDiningTables)
            .set({ status: "occupied", updatedAt: new Date() })
            .where(
              and(
                eq(posDiningTables.organizationId, organizationId),
                eq(posDiningTables.unitId, unitId),
                eq(posDiningTables.id, input.tableId),
              ),
            );
        }
        await this.recordEvent(tx, identityId, organizationId, unitId, tab.id, "tab.opened", {
          tableId: input.tableId,
          guestCount: input.guestCount,
        });
        return { tab };
      },
    );
  }

  async createOrder(
    identityId: string,
    organizationId: string,
    unitId: string,
    tabId: string,
    idempotencyKey: string,
    input: OrderInput,
    offlineIds?: {
      orderId: string;
      itemIds: string[];
      modifierIdForOption: (itemId: string, optionId: string) => string;
    },
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "waiter",
      "cashier",
    ]);
    await this.requireOperationalBilling(organizationId);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "order.create",
      input,
      async (tx) => {
        if (offlineIds && offlineIds.itemIds.length !== input.items.length) {
          throw new BadRequestException({ code: "INVALID_OFFLINE_ENTITY_IDS" });
        }
        await this.requireOpenTab(tx, organizationId, unitId, tabId);
        const [unit] = await tx
          .select({ timezone: units.timezone })
          .from(units)
          .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
          .limit(1);
        if (!unit) throw new NotFoundException({ code: "UNIT_NOT_FOUND" });
        const [order] = await tx
          .insert(posOrders)
          .values({
            ...(offlineIds ? { id: offlineIds.orderId } : {}),
            organizationId,
            unitId,
            tabId,
            createdByIdentityId: identityId,
          })
          .returning();
        if (!order) throw new Error("Order insert did not return a row");
        const createdItems = [];
        for (const [itemIndex, item] of input.items.entries()) {
          const [product] = await tx
            .select({
              id: posProducts.id,
              name: posProducts.name,
              priceCents: posProductPrices.priceCents,
              available: posProductAvailability.available,
              availabilitySchedule: posProductAvailability.schedule,
              stationId: posProductStations.stationId,
            })
            .from(posProducts)
            .innerJoin(
              posProductPrices,
              and(
                eq(posProductPrices.organizationId, posProducts.organizationId),
                eq(posProductPrices.productId, posProducts.id),
                eq(posProductPrices.unitId, unitId),
              ),
            )
            .innerJoin(
              posProductAvailability,
              and(
                eq(posProductAvailability.organizationId, posProducts.organizationId),
                eq(posProductAvailability.productId, posProducts.id),
                eq(posProductAvailability.unitId, unitId),
              ),
            )
            .innerJoin(
              posProductStations,
              and(
                eq(posProductStations.organizationId, posProducts.organizationId),
                eq(posProductStations.productId, posProducts.id),
                eq(posProductStations.unitId, unitId),
              ),
            )
            .where(
              and(
                eq(posProducts.organizationId, organizationId),
                eq(posProducts.id, item.productId),
                eq(posProducts.active, true),
              ),
            )
            .limit(1);
          if (
            !product?.available ||
            !isWithinAvailability(product.availabilitySchedule, new Date(), unit.timezone)
          ) {
            throw new ConflictException({ code: "PRODUCT_UNAVAILABLE", productId: item.productId });
          }
          const optionIds = [...new Set(item.modifierOptionIds)];
          const options =
            optionIds.length === 0
              ? []
              : await tx
                  .select({
                    id: posModifierOptions.id,
                    name: posModifierOptions.name,
                    groupId: posModifierOptions.groupId,
                    priceDeltaCents: posModifierOptions.priceDeltaCents,
                  })
                  .from(posModifierOptions)
                  .innerJoin(
                    posProductModifierGroups,
                    and(
                      eq(
                        posProductModifierGroups.organizationId,
                        posModifierOptions.organizationId,
                      ),
                      eq(posProductModifierGroups.groupId, posModifierOptions.groupId),
                      eq(posProductModifierGroups.productId, item.productId),
                    ),
                  )
                  .where(
                    and(
                      eq(posModifierOptions.organizationId, organizationId),
                      eq(posModifierOptions.active, true),
                      inArray(posModifierOptions.id, optionIds),
                    ),
                  );
          if (options.length !== optionIds.length) {
            throw new BadRequestException({
              code: "INVALID_MODIFIER_SELECTION",
              productId: item.productId,
            });
          }
          const groups = await tx
            .select({
              id: posModifierGroups.id,
              minimum: posModifierGroups.minimumSelections,
              maximum: posModifierGroups.maximumSelections,
            })
            .from(posProductModifierGroups)
            .innerJoin(
              posModifierGroups,
              and(
                eq(posModifierGroups.organizationId, posProductModifierGroups.organizationId),
                eq(posModifierGroups.id, posProductModifierGroups.groupId),
              ),
            )
            .where(
              and(
                eq(posProductModifierGroups.organizationId, organizationId),
                eq(posProductModifierGroups.productId, item.productId),
                eq(posModifierGroups.active, true),
              ),
            );
          for (const group of groups) {
            const count = options.filter((option) => option.groupId === group.id).length;
            if (count < group.minimum || count > group.maximum) {
              throw new BadRequestException({
                code: "MODIFIER_SELECTION_RANGE",
                groupId: group.id,
              });
            }
          }
          const modifierPerUnitCents = options.reduce(
            (sum, option) => sum + option.priceDeltaCents,
            0,
          );
          const amounts = itemAmounts(item.quantity, product.priceCents, modifierPerUnitCents);
          const [created] = await tx
            .insert(posOrderItems)
            .values({
              ...(offlineIds ? { id: offlineIds.itemIds[itemIndex] } : {}),
              organizationId,
              unitId,
              orderId: order.id,
              productId: product.id,
              stationId: product.stationId,
              productName: product.name,
              quantity: item.quantity,
              unitPriceCents: product.priceCents,
              modifiersCents: modifierPerUnitCents * item.quantity,
              ...amounts,
              notes: item.notes,
            })
            .returning();
          if (!created) throw new Error("Order item insert did not return a row");
          if (options.length > 0) {
            await tx.insert(posOrderItemModifiers).values(
              options.map((option) => ({
                id: offlineIds?.modifierIdForOption(created.id, option.id),
                organizationId,
                unitId,
                orderItemId: created.id,
                optionId: option.id,
                name: option.name,
                unitDeltaCents: option.priceDeltaCents,
                totalDeltaCents: option.priceDeltaCents * item.quantity,
              })),
            );
          }
          createdItems.push(created);
        }
        const totals = await this.recalculateTab(tx, organizationId, unitId, tabId);
        await this.recordEvent(tx, identityId, organizationId, unitId, tabId, "order.created", {
          orderId: order.id,
          itemCount: createdItems.length,
        });
        return { order, items: createdItems, totals };
      },
    );
  }

  async sendOrder(
    identityId: string,
    organizationId: string,
    unitId: string,
    orderId: string,
    idempotencyKey: string,
    offlineIds?: { ticketIdForStation: (stationId: string) => string },
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "waiter",
      "cashier",
    ]);
    await this.requireOperationalBilling(organizationId);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "order.send",
      { orderId },
      async (tx) => {
        const [order] = await tx
          .select()
          .from(posOrders)
          .where(
            and(
              eq(posOrders.organizationId, organizationId),
              eq(posOrders.unitId, unitId),
              eq(posOrders.id, orderId),
            ),
          )
          .limit(1);
        if (!order) throw new NotFoundException({ code: "ORDER_NOT_FOUND" });
        if (order.status !== "draft") {
          throw new ConflictException({ code: "ORDER_NOT_DRAFT", status: order.status });
        }
        await this.requireOpenTab(tx, organizationId, unitId, order.tabId);
        const items = await tx
          .select()
          .from(posOrderItems)
          .where(
            and(
              eq(posOrderItems.organizationId, organizationId),
              eq(posOrderItems.unitId, unitId),
              eq(posOrderItems.orderId, orderId),
              eq(posOrderItems.status, "draft"),
            ),
          );
        if (items.length === 0) throw new ConflictException({ code: "ORDER_EMPTY" });
        if (items.some((item) => !item.stationId)) {
          throw new ConflictException({ code: "PRODUCT_WITHOUT_STATION" });
        }
        const now = new Date();
        await tx
          .update(posOrders)
          .set({ status: "sent", sentAt: now, updatedAt: now })
          .where(
            and(
              eq(posOrders.organizationId, organizationId),
              eq(posOrders.unitId, unitId),
              eq(posOrders.id, orderId),
              eq(posOrders.status, "draft"),
            ),
          );
        await tx
          .update(posOrderItems)
          .set({ status: "queued", updatedAt: now })
          .where(
            and(
              eq(posOrderItems.organizationId, organizationId),
              eq(posOrderItems.unitId, unitId),
              eq(posOrderItems.orderId, orderId),
              eq(posOrderItems.status, "draft"),
            ),
          );
        const ticketIds = [];
        const stationIds = [...new Set(items.map((item) => item.stationId as string))];
        for (const stationId of stationIds) {
          const [ticket] = await tx
            .insert(posKdsTickets)
            .values({
              ...(offlineIds ? { id: offlineIds.ticketIdForStation(stationId) } : {}),
              organizationId,
              unitId,
              orderId,
              stationId,
            })
            .returning();
          if (!ticket) throw new Error("KDS ticket insert did not return a row");
          ticketIds.push(ticket.id);
          await tx.insert(posKdsTicketItems).values(
            items
              .filter((item) => item.stationId === stationId)
              .map((item) => ({
                organizationId,
                unitId,
                ticketId: ticket.id,
                orderItemId: item.id,
              })),
          );
        }
        await this.recordEvent(tx, identityId, organizationId, unitId, order.tabId, "order.sent", {
          orderId,
          ticketIds,
        });
        return { orderId, status: "sent", ticketIds };
      },
    );
  }

  async transferTab(
    identityId: string,
    organizationId: string,
    unitId: string,
    tabId: string,
    idempotencyKey: string,
    input: TransferTabInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "waiter",
      "cashier",
    ]);
    await this.requireOperationalBilling(organizationId);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "tab.transfer",
      input,
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`pos-table:${organizationId}:${unitId}:${input.tableId}`}))`,
        );
        const tab = await this.requireOpenTab(tx, organizationId, unitId, tabId);
        const [destination] = await tx
          .select({ id: posDiningTables.id })
          .from(posDiningTables)
          .where(
            and(
              eq(posDiningTables.organizationId, organizationId),
              eq(posDiningTables.unitId, unitId),
              eq(posDiningTables.id, input.tableId),
              eq(posDiningTables.active, true),
            ),
          )
          .limit(1);
        if (!destination) throw new NotFoundException({ code: "TABLE_NOT_FOUND" });
        const [occupied] = await tx
          .select({ id: posTabs.id })
          .from(posTabs)
          .where(
            and(
              eq(posTabs.organizationId, organizationId),
              eq(posTabs.unitId, unitId),
              eq(posTabs.tableId, input.tableId),
              eq(posTabs.status, "open"),
            ),
          )
          .limit(1);
        if (occupied && occupied.id !== tabId) {
          throw new ConflictException({ code: "TABLE_OCCUPIED", tabId: occupied.id });
        }
        await tx
          .update(posTabs)
          .set({ tableId: input.tableId, updatedAt: new Date() })
          .where(
            and(
              eq(posTabs.organizationId, organizationId),
              eq(posTabs.unitId, unitId),
              eq(posTabs.id, tabId),
            ),
          );
        if (tab.tableId && tab.tableId !== input.tableId) {
          await tx
            .update(posDiningTables)
            .set({ status: "available", updatedAt: new Date() })
            .where(
              and(
                eq(posDiningTables.organizationId, organizationId),
                eq(posDiningTables.unitId, unitId),
                eq(posDiningTables.id, tab.tableId),
              ),
            );
        }
        await tx
          .update(posDiningTables)
          .set({ status: "occupied", updatedAt: new Date() })
          .where(
            and(
              eq(posDiningTables.organizationId, organizationId),
              eq(posDiningTables.unitId, unitId),
              eq(posDiningTables.id, input.tableId),
            ),
          );
        await this.recordEvent(tx, identityId, organizationId, unitId, tabId, "tab.transferred", {
          fromTableId: tab.tableId,
          toTableId: input.tableId,
          reason: input.reason,
        });
        return { tabId, tableId: input.tableId };
      },
    );
  }

  async mergeTabs(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: MergeTabsInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "cashier",
    ]);
    await this.requireOperationalBilling(organizationId);
    const sourceIds = [...new Set(input.sourceTabIds)];
    if (sourceIds.includes(input.targetTabId)) {
      throw new BadRequestException({ code: "MERGE_TARGET_IS_SOURCE" });
    }
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "tab.merge",
      { ...input, sourceTabIds: sourceIds },
      async (tx) => {
        const lockIds = [input.targetTabId, ...sourceIds].sort();
        for (const id of lockIds) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`pos-tab:${organizationId}:${unitId}:${id}`}))`,
          );
        }
        const target = await this.requireOpenTab(tx, organizationId, unitId, input.targetTabId);
        const sources = await tx
          .select()
          .from(posTabs)
          .where(
            and(
              eq(posTabs.organizationId, organizationId),
              eq(posTabs.unitId, unitId),
              inArray(posTabs.id, sourceIds),
              eq(posTabs.status, "open"),
            ),
          );
        if (sources.length !== sourceIds.length) {
          throw new NotFoundException({ code: "SOURCE_TAB_NOT_FOUND" });
        }
        await tx
          .update(posOrders)
          .set({ tabId: target.id, updatedAt: new Date() })
          .where(
            and(
              eq(posOrders.organizationId, organizationId),
              eq(posOrders.unitId, unitId),
              inArray(posOrders.tabId, sourceIds),
            ),
          );
        await tx
          .update(posTabs)
          .set({ status: "merged", mergedIntoTabId: target.id, updatedAt: new Date() })
          .where(
            and(
              eq(posTabs.organizationId, organizationId),
              eq(posTabs.unitId, unitId),
              inArray(posTabs.id, sourceIds),
              eq(posTabs.status, "open"),
            ),
          );
        const releasedTableIds = sources
          .map((source) => source.tableId)
          .filter((tableId): tableId is string => Boolean(tableId) && tableId !== target.tableId);
        if (releasedTableIds.length > 0) {
          await tx
            .update(posDiningTables)
            .set({ status: "available", updatedAt: new Date() })
            .where(
              and(
                eq(posDiningTables.organizationId, organizationId),
                eq(posDiningTables.unitId, unitId),
                inArray(posDiningTables.id, releasedTableIds),
              ),
            );
        }
        const totals = await this.recalculateTab(tx, organizationId, unitId, target.id);
        await this.recordEvent(tx, identityId, organizationId, unitId, target.id, "tabs.merged", {
          sourceTabIds: sourceIds,
        });
        return { targetTabId: target.id, sourceTabIds: sourceIds, totals };
      },
    );
  }

  async splitTab(
    identityId: string,
    organizationId: string,
    unitId: string,
    sourceTabId: string,
    idempotencyKey: string,
    input: SplitTabInput,
    offlineIds?: {
      targetTabId: string;
      targetOrderId: string;
      movedItemIdForSource: (sourceItemId: string) => string;
      movedModifierIdForSource: (sourceItemId: string, modifierId: string) => string;
    },
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "cashier",
    ]);
    await this.requireOperationalBilling(organizationId);
    const requestedIds = input.items.map((item) => item.orderItemId);
    if (new Set(requestedIds).size !== requestedIds.length) {
      throw new BadRequestException({ code: "DUPLICATE_SPLIT_ITEM" });
    }
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "tab.split",
      input,
      async (tx) => {
        const source = await this.requireOpenTab(tx, organizationId, unitId, sourceTabId);
        if (input.tableId) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`pos-table:${organizationId}:${unitId}:${input.tableId}`}))`,
          );
          const [table] = await tx
            .select({ id: posDiningTables.id })
            .from(posDiningTables)
            .where(
              and(
                eq(posDiningTables.organizationId, organizationId),
                eq(posDiningTables.unitId, unitId),
                eq(posDiningTables.id, input.tableId),
                eq(posDiningTables.active, true),
              ),
            )
            .limit(1);
          if (!table) throw new NotFoundException({ code: "TABLE_NOT_FOUND" });
          const [occupied] = await tx
            .select({ id: posTabs.id })
            .from(posTabs)
            .where(
              and(
                eq(posTabs.organizationId, organizationId),
                eq(posTabs.unitId, unitId),
                eq(posTabs.tableId, input.tableId),
                eq(posTabs.status, "open"),
              ),
            )
            .limit(1);
          if (occupied) throw new ConflictException({ code: "TABLE_OCCUPIED", tabId: occupied.id });
        }
        const items = await tx
          .select({ item: posOrderItems, orderStatus: posOrders.status })
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
              eq(posOrderItems.organizationId, organizationId),
              eq(posOrderItems.unitId, unitId),
              eq(posOrders.tabId, sourceTabId),
              inArray(posOrderItems.id, requestedIds),
            ),
          );
        if (items.length !== requestedIds.length) {
          throw new NotFoundException({ code: "SPLIT_ITEM_NOT_FOUND" });
        }
        if (items.some(({ item }) => item.status === "canceled")) {
          throw new ConflictException({ code: "CANCELED_ITEM_CANNOT_SPLIT" });
        }
        for (const requested of input.items) {
          const row = items.find(({ item }) => item.id === requested.orderItemId);
          if (!row || requested.quantity > row.item.quantity) {
            throw new BadRequestException({
              code: "INVALID_SPLIT_QUANTITY",
              orderItemId: requested.orderItemId,
            });
          }
        }
        const [target] = await tx
          .insert(posTabs)
          .values({
            id: offlineIds?.targetTabId,
            organizationId,
            unitId,
            tableId: input.tableId,
            openedByIdentityId: identityId,
            label: input.label,
            guestCount: 1,
            serviceChargeBasisPoints: source.serviceChargeBasisPoints,
          })
          .returning();
        if (!target) throw new Error("Split target tab insert did not return a row");
        const hasProductionHistory = items.some(({ orderStatus }) => orderStatus !== "draft");
        const [targetOrder] = await tx
          .insert(posOrders)
          .values({
            id: offlineIds?.targetOrderId,
            organizationId,
            unitId,
            tabId: target.id,
            createdByIdentityId: identityId,
            status: hasProductionHistory ? "sent" : "draft",
            sentAt: hasProductionHistory ? new Date() : undefined,
          })
          .returning();
        if (!targetOrder) throw new Error("Split target order insert did not return a row");
        const movedItemIds: string[] = [];
        for (const requested of input.items) {
          const sourceRow = items.find(({ item }) => item.id === requested.orderItemId);
          if (!sourceRow) throw new Error("Validated split item disappeared");
          const sourceItem = sourceRow.item;
          if (requested.quantity === sourceItem.quantity) {
            await tx
              .update(posOrderItems)
              .set({ orderId: targetOrder.id, updatedAt: new Date() })
              .where(
                and(
                  eq(posOrderItems.organizationId, organizationId),
                  eq(posOrderItems.unitId, unitId),
                  eq(posOrderItems.id, sourceItem.id),
                ),
              );
            movedItemIds.push(sourceItem.id);
            continue;
          }
          const movedGross = Math.floor(
            (sourceItem.grossCents * requested.quantity) / sourceItem.quantity,
          );
          const movedDiscount = Math.floor(
            (sourceItem.discountCents * requested.quantity) / sourceItem.quantity,
          );
          const movedModifiers = Math.floor(
            (sourceItem.modifiersCents * requested.quantity) / sourceItem.quantity,
          );
          const remainingQuantity = sourceItem.quantity - requested.quantity;
          const remainingGross = sourceItem.grossCents - movedGross;
          const remainingDiscount = sourceItem.discountCents - movedDiscount;
          await tx
            .update(posOrderItems)
            .set({
              quantity: remainingQuantity,
              grossCents: remainingGross,
              modifiersCents: sourceItem.modifiersCents - movedModifiers,
              discountCents: remainingDiscount,
              netCents: remainingGross - remainingDiscount,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(posOrderItems.organizationId, organizationId),
                eq(posOrderItems.unitId, unitId),
                eq(posOrderItems.id, sourceItem.id),
              ),
            );
          const [moved] = await tx
            .insert(posOrderItems)
            .values({
              id: offlineIds?.movedItemIdForSource(sourceItem.id),
              organizationId,
              unitId,
              orderId: targetOrder.id,
              productId: sourceItem.productId,
              stationId: sourceItem.stationId,
              productName: sourceItem.productName,
              quantity: requested.quantity,
              unitPriceCents: sourceItem.unitPriceCents,
              modifiersCents: movedModifiers,
              grossCents: movedGross,
              discountCents: movedDiscount,
              netCents: movedGross - movedDiscount,
              status: sourceItem.status,
              notes: sourceItem.notes,
            })
            .returning();
          if (!moved) throw new Error("Split item insert did not return a row");
          movedItemIds.push(moved.id);
          const modifiers = await tx
            .select()
            .from(posOrderItemModifiers)
            .where(
              and(
                eq(posOrderItemModifiers.organizationId, organizationId),
                eq(posOrderItemModifiers.unitId, unitId),
                eq(posOrderItemModifiers.orderItemId, sourceItem.id),
              ),
            );
          for (const modifier of modifiers) {
            const movedDelta = Math.floor(
              (modifier.totalDeltaCents * requested.quantity) / sourceItem.quantity,
            );
            await tx
              .update(posOrderItemModifiers)
              .set({ totalDeltaCents: modifier.totalDeltaCents - movedDelta })
              .where(eq(posOrderItemModifiers.id, modifier.id));
            await tx.insert(posOrderItemModifiers).values({
              id: offlineIds?.movedModifierIdForSource(sourceItem.id, modifier.id),
              organizationId,
              unitId,
              orderItemId: moved.id,
              optionId: modifier.optionId,
              name: modifier.name,
              quantity: modifier.quantity,
              unitDeltaCents: modifier.unitDeltaCents,
              totalDeltaCents: movedDelta,
            });
          }
        }
        if (input.tableId) {
          await tx
            .update(posDiningTables)
            .set({ status: "occupied", updatedAt: new Date() })
            .where(
              and(
                eq(posDiningTables.organizationId, organizationId),
                eq(posDiningTables.unitId, unitId),
                eq(posDiningTables.id, input.tableId),
              ),
            );
        }
        const sourceTotals = await this.recalculateTab(tx, organizationId, unitId, sourceTabId);
        const targetTotals = await this.recalculateTab(tx, organizationId, unitId, target.id);
        await this.recordEvent(tx, identityId, organizationId, unitId, sourceTabId, "tab.split", {
          targetTabId: target.id,
          movedItemIds,
        });
        return { sourceTabId, targetTabId: target.id, movedItemIds, sourceTotals, targetTotals };
      },
    );
  }

  async setServiceCharge(
    identityId: string,
    organizationId: string,
    unitId: string,
    tabId: string,
    idempotencyKey: string,
    input: ServiceChargeInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "cashier",
    ]);
    await this.requireOperationalBilling(organizationId);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "tab.service_charge",
      input,
      async (tx) => {
        await this.requireOpenTab(tx, organizationId, unitId, tabId);
        await tx
          .update(posTabs)
          .set({ serviceChargeBasisPoints: input.basisPoints, updatedAt: new Date() })
          .where(
            and(
              eq(posTabs.organizationId, organizationId),
              eq(posTabs.unitId, unitId),
              eq(posTabs.id, tabId),
            ),
          );
        const totals = await this.recalculateTab(tx, organizationId, unitId, tabId);
        await this.recordEvent(
          tx,
          identityId,
          organizationId,
          unitId,
          tabId,
          "tab.service_charge_changed",
          input,
        );
        return { tabId, totals };
      },
    );
  }

  async setTip(
    identityId: string,
    organizationId: string,
    unitId: string,
    tabId: string,
    idempotencyKey: string,
    input: TipInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "cashier",
    ]);
    await this.requireOperationalBilling(organizationId);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "tab.tip",
      input,
      async (tx) => {
        await this.requireOpenTab(tx, organizationId, unitId, tabId);
        await tx
          .update(posTabs)
          .set({ tipCents: input.tipCents, updatedAt: new Date() })
          .where(
            and(
              eq(posTabs.organizationId, organizationId),
              eq(posTabs.unitId, unitId),
              eq(posTabs.id, tabId),
            ),
          );
        const totals = await this.recalculateTab(tx, organizationId, unitId, tabId);
        await this.recordEvent(
          tx,
          identityId,
          organizationId,
          unitId,
          tabId,
          "tab.tip_changed",
          input,
        );
        return { tabId, totals };
      },
    );
  }

  async discountItem(
    identityId: string,
    organizationId: string,
    unitId: string,
    itemId: string,
    idempotencyKey: string,
    input: DiscountInput,
    offlineIds?: { approvalId: string },
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "waiter",
      "cashier",
    ]);
    await this.requireOperationalBilling(organizationId);
    const idempotencyInput = {
      ...input,
      approval: { ...input.approval, pin: "[redacted]" },
    };
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "item.discount",
      idempotencyInput,
      async (tx) => {
        const row = await this.getScopedItem(tx, organizationId, unitId, itemId);
        if (row.item.status === "canceled") throw new ConflictException({ code: "ITEM_CANCELED" });
        if (input.discountCents > row.item.grossCents) {
          throw new BadRequestException({ code: "DISCOUNT_EXCEEDS_ITEM" });
        }
        const approval = await this.approve(
          tx,
          identityId,
          organizationId,
          unitId,
          "discount",
          "order_item",
          itemId,
          input.approval,
          offlineIds?.approvalId,
        );
        await tx
          .update(posOrderItems)
          .set({
            discountCents: input.discountCents,
            netCents: row.item.grossCents - input.discountCents,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(posOrderItems.organizationId, organizationId),
              eq(posOrderItems.unitId, unitId),
              eq(posOrderItems.id, itemId),
            ),
          );
        const totals = await this.recalculateTab(tx, organizationId, unitId, row.tabId);
        await this.recordEvent(
          tx,
          identityId,
          organizationId,
          unitId,
          row.tabId,
          "item.discounted",
          {
            itemId,
            discountCents: input.discountCents,
            approvalId: approval.id,
          },
        );
        return { itemId, discountCents: input.discountCents, approvalId: approval.id, totals };
      },
    );
  }

  async cancelItem(
    identityId: string,
    organizationId: string,
    unitId: string,
    itemId: string,
    idempotencyKey: string,
    input: CancelItemInput,
    offlineIds?: { approvalId: string },
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "waiter",
      "cashier",
    ]);
    await this.requireOperationalBilling(organizationId);
    const idempotencyInput = {
      ...input,
      approval: { ...input.approval, pin: "[redacted]" },
    };
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "item.cancel",
      idempotencyInput,
      async (tx) => {
        const row = await this.getScopedItem(tx, organizationId, unitId, itemId);
        if (row.item.status === "canceled")
          throw new ConflictException({ code: "ITEM_ALREADY_CANCELED" });
        const approval = await this.approve(
          tx,
          identityId,
          organizationId,
          unitId,
          "cancel",
          "order_item",
          itemId,
          input.approval,
          offlineIds?.approvalId,
        );
        const now = new Date();
        await tx
          .update(posOrderItems)
          .set({
            status: "canceled",
            discountCents: 0,
            netCents: 0,
            canceledAt: now,
            canceledReason: input.approval.reason,
            updatedAt: now,
          })
          .where(
            and(
              eq(posOrderItems.organizationId, organizationId),
              eq(posOrderItems.unitId, unitId),
              eq(posOrderItems.id, itemId),
            ),
          );
        const linkedTickets = await tx
          .select({ id: posKdsTickets.id, status: posKdsTickets.status })
          .from(posKdsTicketItems)
          .innerJoin(
            posKdsTickets,
            and(
              eq(posKdsTickets.organizationId, posKdsTicketItems.organizationId),
              eq(posKdsTickets.unitId, posKdsTicketItems.unitId),
              eq(posKdsTickets.id, posKdsTicketItems.ticketId),
            ),
          )
          .where(
            and(
              eq(posKdsTicketItems.organizationId, organizationId),
              eq(posKdsTicketItems.unitId, unitId),
              eq(posKdsTicketItems.orderItemId, itemId),
            ),
          );
        for (const ticket of linkedTickets) {
          if (ticket.status === "done" || ticket.status === "canceled") continue;
          const activeItems = await tx
            .select({ id: posOrderItems.id })
            .from(posKdsTicketItems)
            .innerJoin(
              posOrderItems,
              and(
                eq(posOrderItems.organizationId, posKdsTicketItems.organizationId),
                eq(posOrderItems.unitId, posKdsTicketItems.unitId),
                eq(posOrderItems.id, posKdsTicketItems.orderItemId),
              ),
            )
            .where(
              and(
                eq(posKdsTicketItems.organizationId, organizationId),
                eq(posKdsTicketItems.unitId, unitId),
                eq(posKdsTicketItems.ticketId, ticket.id),
                sql`${posOrderItems.status} <> 'canceled'`,
              ),
            );
          if (activeItems.length === 0) {
            await tx
              .update(posKdsTickets)
              .set({ status: "canceled", completedAt: now, updatedAt: now })
              .where(
                and(
                  eq(posKdsTickets.organizationId, organizationId),
                  eq(posKdsTickets.unitId, unitId),
                  eq(posKdsTickets.id, ticket.id),
                ),
              );
          }
        }
        const totals = await this.recalculateTab(tx, organizationId, unitId, row.tabId);
        await this.recordEvent(tx, identityId, organizationId, unitId, row.tabId, "item.canceled", {
          itemId,
          approvalId: approval.id,
          reason: input.approval.reason,
        });
        return { itemId, status: "canceled", approvalId: approval.id, totals };
      },
    );
  }

  async listKds(identityId: string, organizationId: string, unitId: string, stationId?: string) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager", "kds"]);
    const where = [
      eq(posKdsTickets.organizationId, organizationId),
      eq(posKdsTickets.unitId, unitId),
    ];
    if (stationId) where.push(eq(posKdsTickets.stationId, stationId));
    const tickets = await this.database.db
      .select()
      .from(posKdsTickets)
      .where(and(...where));
    const ticketIds = tickets.map((ticket) => ticket.id);
    const items =
      ticketIds.length === 0
        ? []
        : await this.database.db
            .select({ ticketId: posKdsTicketItems.ticketId, item: posOrderItems })
            .from(posKdsTicketItems)
            .innerJoin(
              posOrderItems,
              and(
                eq(posOrderItems.organizationId, posKdsTicketItems.organizationId),
                eq(posOrderItems.unitId, posKdsTicketItems.unitId),
                eq(posOrderItems.id, posKdsTicketItems.orderItemId),
              ),
            )
            .where(
              and(
                eq(posKdsTicketItems.organizationId, organizationId),
                eq(posKdsTicketItems.unitId, unitId),
                inArray(posKdsTicketItems.ticketId, ticketIds),
              ),
            );
    return { tickets, items };
  }

  async transitionKds(
    identityId: string,
    organizationId: string,
    unitId: string,
    ticketId: string,
    idempotencyKey: string,
    input: KdsStateInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager", "kds"]);
    await this.requireOperationalBilling(organizationId);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "kds.transition",
      input,
      async (tx) => {
        const [ticket] = await tx
          .select()
          .from(posKdsTickets)
          .where(
            and(
              eq(posKdsTickets.organizationId, organizationId),
              eq(posKdsTickets.unitId, unitId),
              eq(posKdsTickets.id, ticketId),
            ),
          )
          .limit(1);
        if (!ticket) throw new NotFoundException({ code: "KDS_TICKET_NOT_FOUND" });
        assertKdsTransition(ticket.status, input.state);
        const now = new Date();
        await tx
          .update(posKdsTickets)
          .set({
            status: input.state,
            startedAt: input.state === "preparing" ? now : ticket.startedAt,
            readyAt: input.state === "ready" ? now : ticket.readyAt,
            completedAt:
              input.state === "done" || input.state === "canceled" ? now : ticket.completedAt,
            updatedAt: now,
          })
          .where(
            and(
              eq(posKdsTickets.organizationId, organizationId),
              eq(posKdsTickets.unitId, unitId),
              eq(posKdsTickets.id, ticketId),
              eq(posKdsTickets.status, ticket.status),
            ),
          );
        const itemState = {
          preparing: "preparing",
          ready: "ready",
          done: "served",
          canceled: "canceled",
        }[input.state] as "preparing" | "ready" | "served" | "canceled";
        const ticketItems = await tx
          .select({ itemId: posKdsTicketItems.orderItemId })
          .from(posKdsTicketItems)
          .where(
            and(
              eq(posKdsTicketItems.organizationId, organizationId),
              eq(posKdsTicketItems.unitId, unitId),
              eq(posKdsTicketItems.ticketId, ticketId),
            ),
          );
        if (ticketItems.length > 0) {
          await tx
            .update(posOrderItems)
            .set({ status: itemState, updatedAt: now })
            .where(
              and(
                eq(posOrderItems.organizationId, organizationId),
                eq(posOrderItems.unitId, unitId),
                inArray(
                  posOrderItems.id,
                  ticketItems.map((item) => item.itemId),
                ),
                sql`${posOrderItems.status} <> 'canceled'`,
              ),
            );
        }
        const orderTickets = await tx
          .select({ status: posKdsTickets.status })
          .from(posKdsTickets)
          .where(
            and(
              eq(posKdsTickets.organizationId, organizationId),
              eq(posKdsTickets.unitId, unitId),
              eq(posKdsTickets.orderId, ticket.orderId),
            ),
          );
        const orderStatus = this.orderStatusFromTickets(orderTickets.map((entry) => entry.status));
        await tx
          .update(posOrders)
          .set({ status: orderStatus, updatedAt: now })
          .where(
            and(
              eq(posOrders.organizationId, organizationId),
              eq(posOrders.unitId, unitId),
              eq(posOrders.id, ticket.orderId),
            ),
          );
        await tx.insert(auditEvents).values({
          organizationId,
          unitId,
          actorIdentityId: identityId,
          action: "pos.kds.transitioned",
          entityType: "kds_ticket",
          entityId: ticketId,
          metadata: { from: ticket.status, to: input.state, orderId: ticket.orderId },
        });
        await tx.insert(outboxEvents).values({
          organizationId,
          unitId,
          topic: "pos.kds_transitioned",
          aggregateType: "kds_ticket",
          aggregateId: ticketId,
          payload: {
            organizationId,
            unitId,
            ticketId,
            orderId: ticket.orderId,
            state: input.state,
          },
        });
        return { ticketId, state: input.state, orderId: ticket.orderId, orderStatus };
      },
    );
  }

  private orderStatusFromTickets(states: KdsState[]) {
    if (states.every((state) => state === "canceled")) return "canceled" as const;
    if (states.every((state) => state === "done" || state === "canceled")) return "served" as const;
    if (states.every((state) => state === "ready" || state === "done" || state === "canceled")) {
      return "ready" as const;
    }
    if (states.some((state) => state === "preparing")) return "preparing" as const;
    return "sent" as const;
  }

  private async approve(
    tx: Transaction,
    requestedByIdentityId: string,
    organizationId: string,
    unitId: string,
    action: "discount" | "cancel",
    entityType: string,
    entityId: string,
    input: { approverMembershipId: string; pin: string; reason: string },
    approvalId?: string,
  ) {
    const [approver] = await tx
      .select({
        membershipId: memberships.id,
        pinHash: posManagerPins.pinHash,
      })
      .from(memberships)
      .innerJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
      .innerJoin(posManagerPins, eq(posManagerPins.membershipId, memberships.id))
      .where(
        and(
          eq(memberships.id, input.approverMembershipId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          eq(posManagerPins.organizationId, organizationId),
          eq(posManagerPins.active, true),
          inArray(roleBindings.role, ["owner", "manager"]),
          or(isNull(roleBindings.unitId), eq(roleBindings.unitId, unitId)),
        ),
      )
      .limit(1);
    if (!approver || !(await argon2.verify(approver.pinHash, input.pin))) {
      throw new ForbiddenException({
        code: "INVALID_MANAGER_APPROVAL",
        message: "Aprovação gerencial inválida.",
      });
    }
    const [approval] = await tx
      .insert(posOperationApprovals)
      .values({
        id: approvalId,
        organizationId,
        unitId,
        action,
        entityType,
        entityId,
        requestedByIdentityId,
        approvedByMembershipId: approver.membershipId,
        reason: input.reason,
      })
      .returning();
    if (!approval) throw new Error("Approval insert did not return a row");
    return approval;
  }

  private async getScopedItem(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    itemId: string,
  ) {
    const [row] = await tx
      .select({ item: posOrderItems, tabId: posOrders.tabId })
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
          eq(posOrderItems.organizationId, organizationId),
          eq(posOrderItems.unitId, unitId),
          eq(posOrderItems.id, itemId),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException({ code: "ORDER_ITEM_NOT_FOUND" });
    assertTenantScope({ organizationId, unitId }, row.item);
    await this.requireOpenTab(tx, organizationId, unitId, row.tabId);
    return row;
  }

  private async requireOpenTab(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    tabId: string,
  ) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`pos-tab:${organizationId}:${unitId}:${tabId}`}))`,
    );
    const [tab] = await tx
      .select()
      .from(posTabs)
      .where(
        and(
          eq(posTabs.organizationId, organizationId),
          eq(posTabs.unitId, unitId),
          eq(posTabs.id, tabId),
        ),
      )
      .limit(1);
    if (!tab) throw new NotFoundException({ code: "TAB_NOT_FOUND" });
    assertTenantScope({ organizationId, unitId }, tab);
    if (tab.status !== "open")
      throw new ConflictException({ code: "TAB_NOT_OPEN", status: tab.status });
    return tab;
  }

  private async recalculateTab(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    tabId: string,
  ) {
    const [tab] = await tx
      .select({
        serviceChargeBasisPoints: posTabs.serviceChargeBasisPoints,
        tipCents: posTabs.tipCents,
      })
      .from(posTabs)
      .where(
        and(
          eq(posTabs.organizationId, organizationId),
          eq(posTabs.unitId, unitId),
          eq(posTabs.id, tabId),
        ),
      )
      .limit(1);
    if (!tab) throw new NotFoundException({ code: "TAB_NOT_FOUND" });
    const items = await tx
      .select({
        grossCents: posOrderItems.grossCents,
        discountCents: posOrderItems.discountCents,
        status: posOrderItems.status,
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
          eq(posOrderItems.organizationId, organizationId),
          eq(posOrderItems.unitId, unitId),
          eq(posOrders.tabId, tabId),
        ),
      );
    const totals = tabTotals(
      items.map((item) => ({
        grossCents: item.grossCents,
        discountCents: item.discountCents,
        canceled: item.status === "canceled",
      })),
      tab.serviceChargeBasisPoints,
      tab.tipCents,
    );
    await tx
      .update(posTabs)
      .set({ ...totals, updatedAt: new Date() })
      .where(
        and(
          eq(posTabs.organizationId, organizationId),
          eq(posTabs.unitId, unitId),
          eq(posTabs.id, tabId),
        ),
      );
    return totals;
  }

  private async idempotent<T extends JsonResponse>(
    identityId: string,
    organizationId: string,
    unitId: string,
    key: string,
    operation: string,
    input: unknown,
    work: (tx: Transaction) => Promise<T>,
  ) {
    if (!key || key.trim().length < 8 || key.length > 160) {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Envie Idempotency-Key com 8 a 160 caracteres.",
      });
    }
    const normalizedKey = key.trim();
    const hash = requestHash(operation, input);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`pos-idem:${organizationId}:${unitId}:${normalizedKey}`}))`,
      );
      const [existing] = await tx
        .select({
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
      const replay = replayResult<T>(existing, operation, hash);
      if (replay) return replay;
      const response = await work(tx);
      const stored = JSON.parse(JSON.stringify(response)) as T;
      await tx.insert(posIdempotencyReceipts).values({
        id: randomUUID(),
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

  private async recordEvent(
    tx: Transaction,
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    tabId: string,
    type: string,
    payload: Record<string, unknown>,
  ) {
    await tx.insert(posTabEvents).values({
      organizationId,
      unitId,
      tabId,
      actorIdentityId,
      type,
      payload,
    });
    await tx.insert(auditEvents).values({
      organizationId,
      unitId,
      actorIdentityId,
      action: `pos.${type}`,
      entityType: "tab",
      entityId: tabId,
      metadata: payload,
    });
    await tx.insert(outboxEvents).values({
      organizationId,
      unitId,
      topic: `pos.${type}`,
      aggregateType: "tab",
      aggregateId: tabId,
      payload: { organizationId, unitId, tabId, ...payload },
    });
  }
}
