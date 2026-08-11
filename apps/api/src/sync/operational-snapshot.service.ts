import {
  memberships,
  posCatalogCategories,
  posDiningRooms,
  posDiningTables,
  posKdsTicketItems,
  posKdsTickets,
  posManagerPins,
  posModifierGroups,
  posModifierOptions,
  posOrderItemModifiers,
  posOrderItems,
  posOrders,
  posProductAvailability,
  posProductModifierGroups,
  posProductPrices,
  posProductStations,
  posProducts,
  posTabs,
  roleBindings,
} from "@giromesa/db";
import { Injectable } from "@nestjs/common";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { createPriceReference } from "./price-reference.js";

@Injectable()
export class OperationalSnapshotService {
  constructor(private readonly database: DatabaseService) {}

  async capture(organizationId: string, unitId: string) {
    const [
      categories,
      products,
      modifierGroups,
      modifierOptions,
      productModifierGroups,
      prices,
      availability,
      productStations,
      rooms,
      tables,
      tabs,
      tickets,
      actorRoles,
      managerApprovals,
    ] = await Promise.all([
      this.database.db
        .select()
        .from(posCatalogCategories)
        .where(eq(posCatalogCategories.organizationId, organizationId)),
      this.database.db
        .select()
        .from(posProducts)
        .where(eq(posProducts.organizationId, organizationId)),
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
        .from(posProductStations)
        .where(
          and(
            eq(posProductStations.organizationId, organizationId),
            eq(posProductStations.unitId, unitId),
          ),
        ),
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
        .where(and(eq(posTabs.organizationId, organizationId), eq(posTabs.unitId, unitId))),
      this.database.db
        .select()
        .from(posKdsTickets)
        .where(
          and(eq(posKdsTickets.organizationId, organizationId), eq(posKdsTickets.unitId, unitId)),
        ),
      this.database.db
        .select({ identityId: memberships.identityId, role: roleBindings.role })
        .from(memberships)
        .innerJoin(
          roleBindings,
          and(
            eq(roleBindings.membershipId, memberships.id),
            or(isNull(roleBindings.unitId), eq(roleBindings.unitId, unitId)),
          ),
        )
        .where(
          and(eq(memberships.organizationId, organizationId), eq(memberships.status, "active")),
        ),
      this.database.db
        .select({
          membershipId: memberships.id,
          pinHash: posManagerPins.pinHash,
        })
        .from(memberships)
        .innerJoin(
          roleBindings,
          and(
            eq(roleBindings.membershipId, memberships.id),
            inArray(roleBindings.role, ["owner", "manager"]),
            or(isNull(roleBindings.unitId), eq(roleBindings.unitId, unitId)),
          ),
        )
        .innerJoin(
          posManagerPins,
          and(
            eq(posManagerPins.membershipId, memberships.id),
            eq(posManagerPins.organizationId, organizationId),
            eq(posManagerPins.active, true),
          ),
        )
        .where(
          and(eq(memberships.organizationId, organizationId), eq(memberships.status, "active")),
        ),
    ]);

    const openTabs = tabs.filter((tab) => tab.status === "open");
    const tabIds = openTabs.map((tab) => tab.id);
    const orders =
      tabIds.length === 0
        ? []
        : await this.database.db
            .select()
            .from(posOrders)
            .where(
              and(
                eq(posOrders.organizationId, organizationId),
                eq(posOrders.unitId, unitId),
                inArray(posOrders.tabId, tabIds),
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
    const ticketIds = tickets.map((ticket) => ticket.id);
    const kdsItems =
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

    const capturedAt = new Date();
    const actorRoleMap = new Map<string, Set<(typeof actorRoles)[number]["role"]>>();
    for (const row of actorRoles) {
      const roles = actorRoleMap.get(row.identityId) ?? new Set();
      roles.add(row.role);
      actorRoleMap.set(row.identityId, roles);
    }
    return {
      organizationId,
      unitId,
      capturedAt,
      approvals: {
        validUntil: new Date(capturedAt.getTime() + 12 * 60 * 60 * 1_000),
        actors: [...actorRoleMap.entries()].map(([identityId, roles]) => ({
          identityId,
          roles: [...roles],
        })),
        managers: [...new Map(managerApprovals.map((row) => [row.membershipId, row])).values()],
      },
      catalog: {
        categories,
        products,
        modifierGroups,
        modifierOptions: modifierOptions.map((option) => ({
          ...option,
          priceReference: createPriceReference({
            kind: "modifier-option",
            entityId: option.id,
            organizationId,
            unitId,
            priceCents: option.priceDeltaCents,
          }),
        })),
        productModifierGroups,
        prices: prices.map((price) => ({
          ...price,
          priceReference: createPriceReference({
            kind: "product",
            entityId: price.productId,
            organizationId,
            unitId,
            priceCents: price.priceCents,
          }),
        })),
        availability,
        productStations,
      },
      floor: { rooms, tables, openTabs },
      tabs,
      tabDetails: Object.fromEntries(
        openTabs.map((tab) => {
          const tabOrders = orders.filter((order) => order.tabId === tab.id);
          const scopedOrderIds = new Set(tabOrders.map((order) => order.id));
          const tabItems = items.filter((item) => scopedOrderIds.has(item.orderId));
          const scopedItemIds = new Set(tabItems.map((item) => item.id));
          return [
            tab.id,
            {
              tab,
              orders: tabOrders,
              items: tabItems,
              modifiers: modifiers.filter((modifier) => scopedItemIds.has(modifier.orderItemId)),
            },
          ];
        }),
      ),
      kds: { tickets, items: kdsItems },
    };
  }
}
