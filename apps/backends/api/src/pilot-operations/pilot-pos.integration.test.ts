import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  identities,
  memberships,
  organizations,
  outboxEvents,
  posCatalogBranding,
  posCatalogCategories,
  posDiningRooms,
  posDiningTables,
  posKdsAttentionAcknowledgements,
  posKdsBatchAssignments,
  posKdsTicketItems,
  posKdsTickets,
  posOrderItems,
  posOrders,
  posProductAvailability,
  posProductionStations,
  posProductPrices,
  posProductStations,
  posProducts,
  roleBindings,
  units,
} from "@giromesa/db";
import { and, eq, inArray } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { PilotPosService } from "./pilot-pos.service.js";
import { kdsAttentionRevision } from "./pilot-rules.js";
import {
  kdsAnalyticsResponseSchema,
  kdsReadModelSchema,
  type TerminalProfileInput,
} from "./pilot-schemas.js";

it("runs a tenant-isolated, idempotent POS and KDS flow against PostgreSQL", async (context) => {
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("PILOT_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  try {
    const runId = randomUUID();
    const documentPrefix = runId.replaceAll("-", "").slice(0, 13);
    const scope = new ScopeService(database);
    const pos = new PilotPosService(database, scope);
    const [organizationA, organizationB] = await database.db
      .insert(organizations)
      .values([
        {
          legalName: "Pilot A Ltda",
          tradeName: "Pilot A",
          document: `${documentPrefix}1`,
          billingState: "active",
        },
        {
          legalName: "Pilot B Ltda",
          tradeName: "Pilot B",
          document: `${documentPrefix}2`,
          billingState: "active",
        },
      ])
      .returning();
    assert.ok(organizationA && organizationB);
    const [unitA, unitB] = await database.db
      .insert(units)
      .values([
        { organizationId: organizationA.id, name: "Unidade A" },
        { organizationId: organizationB.id, name: "Unidade B" },
      ])
      .returning();
    assert.ok(unitA && unitB);
    await database.db.insert(posCatalogBranding).values({
      organizationId: organizationA.id,
      unitId: unitA.id,
      config: {
        displayName: "Restaurante Pilot A",
        primaryColor: "#10b981",
        accentColor: "#10b981",
      },
    });
    const [identity] = await database.db
      .insert(identities)
      .values({ email: `pilot-owner+${runId}@example.test`, displayName: "Pilot Owner" })
      .returning();
    assert.ok(identity);
    const [membership] = await database.db
      .insert(memberships)
      .values({ identityId: identity.id, organizationId: organizationA.id, status: "active" })
      .returning();
    assert.ok(membership);
    await database.db.insert(roleBindings).values({ membershipId: membership.id, role: "owner" });
    const [supportIdentity] = await database.db
      .insert(identities)
      .values({ email: `pilot-waiter+${runId}@example.test`, displayName: "Pilot Waiter" })
      .returning();
    assert.ok(supportIdentity);
    const [supportMembership] = await database.db
      .insert(memberships)
      .values({
        identityId: supportIdentity.id,
        organizationId: organizationA.id,
        status: "active",
      })
      .returning();
    assert.ok(supportMembership);
    await database.db.insert(roleBindings).values({
      membershipId: supportMembership.id,
      unitId: unitA.id,
      role: "waiter",
    });
    const [kdsIdentity] = await database.db
      .insert(identities)
      .values({ email: `pilot-kds+${runId}@example.test`, displayName: "Pilot KDS" })
      .returning();
    assert.ok(kdsIdentity);
    const [kdsMembership] = await database.db
      .insert(memberships)
      .values({
        identityId: kdsIdentity.id,
        organizationId: organizationA.id,
        status: "active",
      })
      .returning();
    assert.ok(kdsMembership);
    await database.db.insert(roleBindings).values({
      membershipId: kdsMembership.id,
      unitId: unitA.id,
      role: "kds",
    });

    const [category] = await database.db
      .insert(posCatalogCategories)
      .values({ organizationId: organizationA.id, name: "Pratos", slug: "pratos" })
      .returning();
    const [station] = await database.db
      .insert(posProductionStations)
      .values({
        organizationId: organizationA.id,
        unitId: unitA.id,
        name: "Cozinha",
        code: "cozinha",
      })
      .returning();
    assert.ok(category && station);
    const [product] = await database.db
      .insert(posProducts)
      .values({
        organizationId: organizationA.id,
        categoryId: category.id,
        name: "Executivo",
      })
      .returning();
    assert.ok(product);
    await database.db.insert(posProductPrices).values({
      organizationId: organizationA.id,
      unitId: unitA.id,
      productId: product.id,
      priceCents: 1_000,
    });
    await database.db.insert(posProductAvailability).values({
      organizationId: organizationA.id,
      unitId: unitA.id,
      productId: product.id,
      available: true,
    });
    await database.db.insert(posProductStations).values({
      organizationId: organizationA.id,
      unitId: unitA.id,
      productId: product.id,
      stationId: station.id,
    });
    const [room] = await database.db
      .insert(posDiningRooms)
      .values({ organizationId: organizationA.id, unitId: unitA.id, name: "Salão" })
      .returning();
    assert.ok(room);
    const [table] = await database.db
      .insert(posDiningTables)
      .values({
        organizationId: organizationA.id,
        unitId: unitA.id,
        roomId: room.id,
        label: "01",
      })
      .returning();
    assert.ok(table);

    await assert.rejects(() => pos.listFloor(identity.id, organizationB.id, unitB.id));
    await assert.rejects(() => pos.listFloor(identity.id, organizationA.id, unitB.id));

    await pos.updateFloorLayout(identity.id, organizationA.id, unitA.id, {
      tables: [{ tableId: table.id, x: 240, y: 180 }],
      rooms: [
        {
          roomId: room.id,
          points: [
            { x: 20, y: 20 },
            { x: 460, y: 20 },
            { x: 440, y: 300 },
            { x: 20, y: 300 },
          ],
        },
      ],
    });
    const floorWithLayout = await pos.listFloor(identity.id, organizationA.id, unitA.id);
    const positionedTable = floorWithLayout.tables.find((candidate) => candidate.id === table.id);
    assert.equal(positionedTable?.layoutX, 240);
    assert.equal(positionedTable?.layoutY, 180);
    assert.deepEqual(
      floorWithLayout.rooms.find((candidate) => candidate.id === room.id)?.layoutPolygon,
      [
        { x: 20, y: 20 },
        { x: 460, y: 20 },
        { x: 440, y: 300 },
        { x: 20, y: 300 },
      ],
    );

    const opened = await pos.openTab(identity.id, organizationA.id, unitA.id, "open-tab-0001", {
      tableId: table.id,
      guestCount: 2,
    });
    const replayed = await pos.openTab(identity.id, organizationA.id, unitA.id, "open-tab-0001", {
      tableId: table.id,
      guestCount: 2,
    });
    assert.equal(replayed.idempotentReplay, true);
    assert.equal((replayed.tab as { id: string }).id, (opened.tab as { id: string }).id);
    await assert.rejects(() =>
      pos.openTab(supportIdentity.id, organizationA.id, unitA.id, "open-tab-0001", {
        tableId: table.id,
        guestCount: 2,
      }),
    );
    const tabId = (opened.tab as { id: string }).id;

    const orderResult = await pos.createOrder(
      identity.id,
      organizationA.id,
      unitA.id,
      tabId,
      "create-order-0001",
      { items: [{ productId: product.id, quantity: 2, modifierOptionIds: [] }] },
    );
    const order = orderResult.order as { id: string };
    const item = (orderResult.items as { id: string }[])[0];
    assert.ok(item);
    await pos.setServiceCharge(
      identity.id,
      organizationA.id,
      unitA.id,
      tabId,
      "service-charge-0001",
      { basisPoints: 1_000 },
    );
    await pos.setTip(identity.id, organizationA.id, unitA.id, tabId, "tip-command-0001", {
      tipCents: 100,
    });
    await pos.setManagerPin(identity.id, organizationA.id, unitA.id, { pin: "1234" });
    const [groupCloseTableA, groupCloseTableB] = await database.db
      .insert(posDiningTables)
      .values([
        {
          organizationId: organizationA.id,
          unitId: unitA.id,
          roomId: room.id,
          label: "05",
        },
        {
          organizationId: organizationA.id,
          unitId: unitA.id,
          roomId: room.id,
          label: "06",
        },
      ])
      .returning();
    assert.ok(groupCloseTableA && groupCloseTableB);
    const groupCloseOpened = await pos.openTab(
      identity.id,
      organizationA.id,
      unitA.id,
      "open-group-close-0001",
      { tableId: groupCloseTableA.id, guestCount: 1 },
    );
    const groupCloseTabId = (groupCloseOpened.tab as { id: string }).id;
    await pos.groupTables(identity.id, organizationA.id, unitA.id, "group-close-0001", {
      tableIds: [groupCloseTableA.id, groupCloseTableB.id],
      anchorTableId: groupCloseTableA.id,
      mode: "single_tab",
      targetTabId: groupCloseTabId,
    });
    await pos.closeTab(
      identity.id,
      organizationA.id,
      unitA.id,
      groupCloseTabId,
      "close-group-0001",
      { printRequested: false },
    );
    let groupCloseFloor = await pos.listFloor(identity.id, organizationA.id, unitA.id);
    assert.equal(
      groupCloseFloor.tables
        .filter((candidate) => [groupCloseTableA.id, groupCloseTableB.id].includes(candidate.id))
        .every((candidate) => candidate.status === "needs_cleaning"),
      true,
    );
    await pos.reopenTab(
      identity.id,
      organizationA.id,
      unitA.id,
      groupCloseTabId,
      "reopen-group-0001",
      { pin: "1234", reason: "Correção operacional" },
    );
    groupCloseFloor = await pos.listFloor(identity.id, organizationA.id, unitA.id);
    assert.equal(
      groupCloseFloor.tables
        .filter((candidate) => [groupCloseTableA.id, groupCloseTableB.id].includes(candidate.id))
        .every((candidate) => candidate.status === "occupied"),
      true,
    );
    await pos.closeTab(
      identity.id,
      organizationA.id,
      unitA.id,
      groupCloseTabId,
      "close-group-0002",
      { printRequested: false },
    );
    await assert.rejects(
      () =>
        pos.discountItem(
          supportIdentity.id,
          organizationA.id,
          unitA.id,
          item.id,
          "discount-item-denied-0001",
          {
            discountCents: 100,
            approval: { approverMembershipId: membership.id, pin: "1234", reason: "Cortesia" },
          },
        ),
      /não autorizada/,
    );
    const discounted = await pos.discountItem(
      identity.id,
      organizationA.id,
      unitA.id,
      item.id,
      "discount-item-0001",
      {
        discountCents: 100,
        approval: { approverMembershipId: membership.id, pin: "1234", reason: "Cortesia" },
      },
    );
    assert.deepEqual(discounted.totals, {
      subtotalCents: 2_000,
      discountCents: 100,
      serviceChargeCents: 190,
      tipCents: 100,
      totalCents: 2_190,
    });

    const sent = await pos.sendOrder(
      identity.id,
      organizationA.id,
      unitA.id,
      order.id,
      "send-order-0001",
    );
    const ticketId = (sent.ticketIds as string[])[0];
    assert.ok(ticketId);
    const concurrentKdsTransitions = await Promise.allSettled([
      pos.transitionKds(identity.id, organizationA.id, unitA.id, ticketId, "kds-preparing-0001", {
        state: "preparing",
      }),
      pos.transitionKds(identity.id, organizationA.id, unitA.id, ticketId, "kds-preparing-0002", {
        state: "preparing",
      }),
    ]);
    assert.equal(
      concurrentKdsTransitions.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      concurrentKdsTransitions.filter((result) => result.status === "rejected").length,
      1,
    );
    const partiallyReady = await pos.transitionKdsItem(
      identity.id,
      organizationA.id,
      unitA.id,
      ticketId,
      item.id,
      "kds-item-ready-0001",
      { state: "ready", quantity: 1 },
    );
    assert.equal(partiallyReady.readyQuantity, 1);
    const [partialAssignment] = await database.db
      .select({
        status: posKdsTicketItems.status,
        quantity: posKdsTicketItems.quantity,
        readyQuantity: posKdsTicketItems.readyQuantity,
      })
      .from(posKdsTicketItems)
      .where(
        and(
          eq(posKdsTicketItems.organizationId, organizationA.id),
          eq(posKdsTicketItems.unitId, unitA.id),
          eq(posKdsTicketItems.ticketId, ticketId),
          eq(posKdsTicketItems.orderItemId, item.id),
        ),
      )
      .limit(1);
    const [partialTicket] = await database.db
      .select({ status: posKdsTickets.status })
      .from(posKdsTickets)
      .where(
        and(
          eq(posKdsTickets.organizationId, organizationA.id),
          eq(posKdsTickets.unitId, unitA.id),
          eq(posKdsTickets.id, ticketId),
        ),
      )
      .limit(1);
    assert.deepEqual(partialAssignment, { status: "preparing", quantity: 2, readyQuantity: 1 });
    assert.equal(partialTicket?.status, "preparing");
    await pos.transitionKdsItem(
      identity.id,
      organizationA.id,
      unitA.id,
      ticketId,
      item.id,
      "kds-item-ready-0002",
      { state: "ready", quantity: 1 },
    );
    await pos.handoffKdsOrder(identity.id, organizationA.id, unitA.id, order.id, "kds-done-0001", {
      target: "expedition",
    });
    const [expeditionTicket] = await database.db
      .select({
        status: posKdsTickets.status,
        handedOffAt: posKdsTickets.handedOffAt,
        servedAt: posKdsTickets.servedAt,
      })
      .from(posKdsTickets)
      .where(
        and(
          eq(posKdsTickets.organizationId, organizationA.id),
          eq(posKdsTickets.unitId, unitA.id),
          eq(posKdsTickets.id, ticketId),
        ),
      )
      .limit(1);
    const [readyOrder] = await database.db
      .select({ status: posOrders.status, readyNotifiedAt: posOrders.readyNotifiedAt })
      .from(posOrders)
      .where(
        and(
          eq(posOrders.organizationId, organizationA.id),
          eq(posOrders.unitId, unitA.id),
          eq(posOrders.id, order.id),
        ),
      )
      .limit(1);
    assert.equal(expeditionTicket?.status, "done");
    assert.ok(expeditionTicket?.handedOffAt);
    assert.equal(expeditionTicket?.servedAt, null);
    assert.equal(readyOrder?.status, "ready");
    assert.ok(readyOrder?.readyNotifiedAt);
    await assert.rejects(() =>
      pos.transitionKds(identity.id, organizationA.id, unitA.id, ticketId, "kds-reverse-0001", {
        state: "ready",
      }),
    );
    await pos.handoffKdsOrder(
      identity.id,
      organizationA.id,
      unitA.id,
      order.id,
      "kds-served-0001",
      { target: "served" },
    );
    const [servedTicket] = await database.db
      .select({ servedAt: posKdsTickets.servedAt })
      .from(posKdsTickets)
      .where(
        and(
          eq(posKdsTickets.organizationId, organizationA.id),
          eq(posKdsTickets.unitId, unitA.id),
          eq(posKdsTickets.id, ticketId),
        ),
      )
      .limit(1);
    const [servedOrder] = await database.db
      .select({ status: posOrders.status })
      .from(posOrders)
      .where(
        and(
          eq(posOrders.organizationId, organizationA.id),
          eq(posOrders.unitId, unitA.id),
          eq(posOrders.id, order.id),
        ),
      )
      .limit(1);
    assert.ok(servedTicket?.servedAt);
    assert.equal(servedOrder?.status, "served");

    const baselineTab = (await pos.getTab(identity.id, organizationA.id, unitA.id, tabId)).tab;
    const baselineTotals = {
      subtotalCents: baselineTab.subtotalCents,
      discountCents: baselineTab.discountCents,
      serviceChargeCents: baselineTab.serviceChargeCents,
      tipCents: baselineTab.tipCents,
      totalCents: baselineTab.totalCents,
    };
    const [stockBeforeCancellation] = await database.db
      .select({ soldToday: posProductAvailability.soldToday })
      .from(posProductAvailability)
      .where(
        and(
          eq(posProductAvailability.organizationId, organizationA.id),
          eq(posProductAvailability.unitId, unitA.id),
          eq(posProductAvailability.productId, product.id),
        ),
      )
      .limit(1);
    assert.ok(stockBeforeCancellation);
    const cancellationOrderResult = await pos.createOrder(
      identity.id,
      organizationA.id,
      unitA.id,
      tabId,
      "create-order-cancellation-0001",
      { items: [{ productId: product.id, quantity: 2, modifierOptionIds: [] }] },
    );
    const cancellationOrder = cancellationOrderResult.order as { id: string };
    const cancellationSent = await pos.sendOrder(
      identity.id,
      organizationA.id,
      unitA.id,
      cancellationOrder.id,
      "send-order-cancellation-0001",
    );
    const cancellationTicketId = (cancellationSent.ticketIds as string[])[0];
    assert.ok(cancellationTicketId);
    const [stockReservedForCancellation] = await database.db
      .select({ soldToday: posProductAvailability.soldToday })
      .from(posProductAvailability)
      .where(
        and(
          eq(posProductAvailability.organizationId, organizationA.id),
          eq(posProductAvailability.unitId, unitA.id),
          eq(posProductAvailability.productId, product.id),
        ),
      )
      .limit(1);
    assert.equal(stockReservedForCancellation?.soldToday, stockBeforeCancellation.soldToday + 2);
    const cancellation = await pos.cancelKdsTicket(
      identity.id,
      organizationA.id,
      unitA.id,
      cancellationTicketId,
      "cancel-kds-ticket-0001",
      {
        approval: {
          approverMembershipId: membership.id,
          pin: "1234",
          reason: "Cancelamento integrado da cozinha",
        },
      },
    );
    assert.ok(cancellation.approvalId);
    assert.deepEqual(cancellation.totals, [{ tabId, totals: baselineTotals }]);
    const [stockAfterCancellation] = await database.db
      .select({ soldToday: posProductAvailability.soldToday })
      .from(posProductAvailability)
      .where(
        and(
          eq(posProductAvailability.organizationId, organizationA.id),
          eq(posProductAvailability.unitId, unitA.id),
          eq(posProductAvailability.productId, product.id),
        ),
      )
      .limit(1);
    assert.equal(stockAfterCancellation?.soldToday, stockBeforeCancellation.soldToday);
    const cancellationSnapshot = await pos.snapshotKds(organizationA.id, unitA.id);
    const cancellationAlerts = cancellationSnapshot.alerts as {
      ticket: { id: string };
      reason: string;
      items: { kds: { status: string } }[];
    }[];
    const cancellationAlert = cancellationAlerts.find(
      (alert) => alert.ticket.id === cancellationTicketId,
    );
    assert.equal(cancellationAlert?.reason, "Cancelamento integrado da cozinha");
    assert.equal(cancellationAlert?.items.length, 1);
    assert.equal(cancellationAlert?.items[0]?.kds.status, "canceled");

    const splitOrderResult = await pos.createOrder(
      identity.id,
      organizationA.id,
      unitA.id,
      tabId,
      "create-order-split-0001",
      { items: [{ productId: product.id, quantity: 2, modifierOptionIds: [] }] },
    );
    const splitOrder = splitOrderResult.order as { id: string };
    const splitItem = (splitOrderResult.items as { id: string }[])[0];
    assert.ok(splitItem);
    const splitSent = await pos.sendOrder(
      identity.id,
      organizationA.id,
      unitA.id,
      splitOrder.id,
      "send-order-split-0001",
    );
    const splitSourceTicketId = (splitSent.ticketIds as string[])[0];
    assert.ok(splitSourceTicketId);
    const split = await pos.splitTab(
      identity.id,
      organizationA.id,
      unitA.id,
      tabId,
      "split-tab-kds-0001",
      {
        label: "Conta dividida KDS",
        items: [{ orderItemId: splitItem.id, quantity: 1 }],
      },
    );
    const splitTargetTabId = split.targetTabId as string;
    const movedSplitItemId = (split.movedItemIds as string[])[0];
    assert.ok(movedSplitItemId);
    const splitTargetTab = await pos.getTab(
      identity.id,
      organizationA.id,
      unitA.id,
      splitTargetTabId,
    );
    const splitTargetOrder = splitTargetTab.orders[0];
    assert.ok(splitTargetOrder);
    const splitAssignments = await database.db
      .select({
        ticketId: posKdsTicketItems.ticketId,
        orderItemId: posKdsTicketItems.orderItemId,
        quantity: posKdsTicketItems.quantity,
        readyQuantity: posKdsTicketItems.readyQuantity,
        status: posKdsTicketItems.status,
      })
      .from(posKdsTicketItems)
      .where(
        and(
          eq(posKdsTicketItems.organizationId, organizationA.id),
          eq(posKdsTicketItems.unitId, unitA.id),
          inArray(posKdsTicketItems.orderItemId, [splitItem.id, movedSplitItemId]),
        ),
      );
    assert.equal(splitAssignments.length, 2);
    const sourceSplitAssignment = splitAssignments.find(
      (assignment) => assignment.orderItemId === splitItem.id,
    );
    const targetSplitAssignment = splitAssignments.find(
      (assignment) => assignment.orderItemId === movedSplitItemId,
    );
    assert.deepEqual(
      {
        quantity: sourceSplitAssignment?.quantity,
        readyQuantity: sourceSplitAssignment?.readyQuantity,
        status: sourceSplitAssignment?.status,
      },
      { quantity: 1, readyQuantity: 0, status: "queued" },
    );
    assert.deepEqual(
      {
        quantity: targetSplitAssignment?.quantity,
        readyQuantity: targetSplitAssignment?.readyQuantity,
        status: targetSplitAssignment?.status,
      },
      { quantity: 1, readyQuantity: 0, status: "queued" },
    );
    assert.notEqual(sourceSplitAssignment?.ticketId, targetSplitAssignment?.ticketId);
    const splitTicketIds = [
      sourceSplitAssignment?.ticketId,
      targetSplitAssignment?.ticketId,
    ].filter((candidate): candidate is string => Boolean(candidate));
    const splitTickets = await database.db
      .select({
        id: posKdsTickets.id,
        orderId: posKdsTickets.orderId,
        stationId: posKdsTickets.stationId,
        status: posKdsTickets.status,
      })
      .from(posKdsTickets)
      .where(
        and(
          eq(posKdsTickets.organizationId, organizationA.id),
          eq(posKdsTickets.unitId, unitA.id),
          inArray(posKdsTickets.id, splitTicketIds),
        ),
      );
    const sourceSplitTicket = splitTickets.find((ticket) => ticket.id === splitSourceTicketId);
    const targetSplitTicket = splitTickets.find(
      (ticket) => ticket.id === targetSplitAssignment?.ticketId,
    );
    assert.equal(sourceSplitTicket?.orderId, splitOrder.id);
    assert.equal(targetSplitTicket?.orderId, splitTargetOrder.id);
    assert.equal(sourceSplitTicket?.stationId, station.id);
    assert.equal(targetSplitTicket?.stationId, station.id);
    assert.equal(sourceSplitTicket?.status, "pending");
    assert.equal(targetSplitTicket?.status, "pending");
    const splitSnapshot = await pos.snapshotKds(organizationA.id, unitA.id);
    const splitAlerts = splitSnapshot.alerts as { ticket: { id: string } }[];
    assert.equal(
      splitAlerts.some((alert) => alert.ticket.id === splitSourceTicketId),
      false,
    );

    const [secondStation, rerouteSourceStation, inactiveStation] = await database.db
      .insert(posProductionStations)
      .values([
        {
          organizationId: organizationA.id,
          unitId: unitA.id,
          name: "Finalização",
          code: `finalizacao-${documentPrefix}`,
        },
        {
          organizationId: organizationA.id,
          unitId: unitA.id,
          name: "Apoio temporário",
          code: `apoio-${documentPrefix}`,
        },
        {
          organizationId: organizationA.id,
          unitId: unitA.id,
          name: "Praça inativa",
          code: `inativa-${documentPrefix}`,
          active: false,
        },
      ])
      .returning();
    assert.ok(secondStation && rerouteSourceStation && inactiveStation);
    const [multiProduct, targetProduct, rerouteProduct] = await database.db
      .insert(posProducts)
      .values([
        {
          organizationId: organizationA.id,
          categoryId: category.id,
          name: `Prato multi praça ${documentPrefix}`,
        },
        {
          organizationId: organizationA.id,
          categoryId: category.id,
          name: `Finalização alvo ${documentPrefix}`,
        },
        {
          organizationId: organizationA.id,
          categoryId: category.id,
          name: `Preparo reroute ${documentPrefix}`,
        },
      ])
      .returning();
    assert.ok(multiProduct && targetProduct && rerouteProduct);
    await database.db.insert(posProductPrices).values(
      [multiProduct, targetProduct, rerouteProduct].map((candidate) => ({
        organizationId: organizationA.id,
        unitId: unitA.id,
        productId: candidate.id,
        priceCents: 1_200,
      })),
    );
    await database.db.insert(posProductAvailability).values(
      [multiProduct, targetProduct, rerouteProduct].map((candidate) => ({
        organizationId: organizationA.id,
        unitId: unitA.id,
        productId: candidate.id,
        available: true,
      })),
    );
    await database.db.insert(posProductStations).values([
      {
        organizationId: organizationA.id,
        unitId: unitA.id,
        productId: multiProduct.id,
        stationId: station.id,
      },
      {
        organizationId: organizationA.id,
        unitId: unitA.id,
        productId: multiProduct.id,
        stationId: secondStation.id,
      },
      {
        organizationId: organizationA.id,
        unitId: unitA.id,
        productId: targetProduct.id,
        stationId: secondStation.id,
      },
      {
        organizationId: organizationA.id,
        unitId: unitA.id,
        productId: rerouteProduct.id,
        stationId: rerouteSourceStation.id,
      },
    ]);

    const multiOrderResult = await pos.createOrder(
      identity.id,
      organizationA.id,
      unitA.id,
      tabId,
      "create-order-multi-station-0001",
      {
        items: [
          {
            productId: multiProduct.id,
            quantity: 1,
            modifierOptionIds: [],
            allergyNote: "Sem lactose",
            notes: "Finalizar sem manteiga",
          },
        ],
      },
    );
    const multiOrder = multiOrderResult.order as { id: string };
    const multiItem = (multiOrderResult.items as { id: string; stationId: string }[])[0];
    assert.ok(multiItem);
    assert.equal(multiItem.stationId, [station.id, secondStation.id].sort()[0]);
    const multiSent = await pos.sendOrder(
      identity.id,
      organizationA.id,
      unitA.id,
      multiOrder.id,
      "send-order-multi-station-0001",
    );
    const multiTicketIds = multiSent.ticketIds as string[];
    assert.equal(multiTicketIds.length, 2);
    const multiTickets = await database.db
      .select({ id: posKdsTickets.id, stationId: posKdsTickets.stationId })
      .from(posKdsTickets)
      .where(
        and(
          eq(posKdsTickets.organizationId, organizationA.id),
          eq(posKdsTickets.unitId, unitA.id),
          eq(posKdsTickets.orderId, multiOrder.id),
        ),
      );
    const firstMultiTicket = multiTickets.find((candidate) => candidate.stationId === station.id);
    const secondMultiTicket = multiTickets.find(
      (candidate) => candidate.stationId === secondStation.id,
    );
    assert.ok(firstMultiTicket && secondMultiTicket);
    const stationInstallationId = randomUUID();
    const passInstallationId = randomUUID();
    await pos.putKdsTerminalProfile(
      identity.id,
      organizationA.id,
      unitA.id,
      stationInstallationId,
      "terminal-station-0001",
      {
        mode: "station",
        stationId: station.id,
        label: "Terminal Cozinha",
        soundEnabled: true,
        fullscreenPreferred: true,
      },
    );
    await pos.putKdsTerminalProfile(
      identity.id,
      organizationA.id,
      unitA.id,
      passInstallationId,
      "terminal-pass-0001",
      {
        mode: "pass",
        stationId: null,
        label: "Passe Principal",
        soundEnabled: true,
        fullscreenPreferred: false,
      },
    );
    assert.equal(
      (
        await pos.getKdsTerminalProfile(
          kdsIdentity.id,
          organizationA.id,
          unitA.id,
          passInstallationId,
        )
      ).mode,
      "pass",
    );
    const sharedInstallationId = randomUUID();
    const sharedProfileInput: TerminalProfileInput = {
      label: "Caixa principal",
      mode: "cashier" as const,
      defaultRoute: "counter" as const,
      printerId: "receipt-main",
      stationId: null,
      compact: true,
      quickActions: ["receive", "print", "search"],
    };
    await pos.putTerminalProfile(
      identity.id,
      organizationA.id,
      unitA.id,
      sharedInstallationId,
      "terminal-profile-0001",
      sharedProfileInput,
    );
    const sharedProfile = await pos.getTerminalProfile(
      kdsIdentity.id,
      organizationA.id,
      unitA.id,
      sharedInstallationId,
    );
    assert.equal(sharedProfile?.defaultRoute, "counter");
    assert.equal(sharedProfile?.printerId, "receipt-main");
    await assert.rejects(
      () =>
        pos.putTerminalProfile(
          kdsIdentity.id,
          organizationA.id,
          unitA.id,
          sharedInstallationId,
          "terminal-profile-denied-0001",
          sharedProfileInput,
        ),
      (error: unknown) =>
        (error as { getResponse?: () => { code?: string } }).getResponse?.().code ===
        "POS_ROLE_DENIED",
    );
    await assert.rejects(
      () =>
        pos.setKdsOrderPriority(
          kdsIdentity.id,
          organizationA.id,
          unitA.id,
          multiOrder.id,
          "priority-from-station-0001",
          {
            priority: 80,
            reason: "Atraso informado pelo atendimento",
            installationId: stationInstallationId,
          },
        ),
      (error: unknown) =>
        (error as { getResponse?: () => { code?: string } }).getResponse?.().code ===
        "KDS_PASS_TERMINAL_REQUIRED",
    );
    const prioritized = await pos.setKdsOrderPriority(
      kdsIdentity.id,
      organizationA.id,
      unitA.id,
      multiOrder.id,
      "priority-from-pass-0001",
      {
        priority: 80,
        reason: "Atraso informado pelo atendimento",
        installationId: passInstallationId,
      },
    );
    assert.equal(prioritized.priority, 80);
    assert.deepEqual([...prioritized.ticketIds].sort(), [...multiTicketIds].sort());
    assert.equal(
      (
        await pos.setKdsOrderPriority(
          kdsIdentity.id,
          organizationA.id,
          unitA.id,
          multiOrder.id,
          "priority-from-pass-0001",
          {
            priority: 80,
            reason: "Atraso informado pelo atendimento",
            installationId: passInstallationId,
          },
        )
      ).idempotentReplay,
      true,
    );
    const coordinatedPriority = await database.db
      .select({ priority: posKdsTickets.priority })
      .from(posKdsTickets)
      .where(
        and(
          eq(posKdsTickets.organizationId, organizationA.id),
          eq(posKdsTickets.unitId, unitA.id),
          eq(posKdsTickets.orderId, multiOrder.id),
        ),
      );
    assert.deepEqual(
      coordinatedPriority.map(({ priority }) => priority),
      [80, 80],
    );
    const resetAt = new Date(Date.now() + 60 * 60_000);
    const unavailable = await pos.setKdsProductAvailability(
      identity.id,
      organizationA.id,
      unitA.id,
      multiProduct.id,
      "availability-lifecycle-0001",
      {
        available: false,
        reason: "Insumo em reposição",
        resetAt: resetAt.toISOString(),
        dailyStock: 3,
      },
    );
    assert.equal(unavailable.status, "unavailable");
    assert.equal(unavailable.remainingQuantity, 2);
    await database.db
      .update(posProductAvailability)
      .set({ operationalResetAt: new Date(Date.now() - 1_000) })
      .where(
        and(
          eq(posProductAvailability.organizationId, organizationA.id),
          eq(posProductAvailability.unitId, unitA.id),
          eq(posProductAvailability.productId, multiProduct.id),
        ),
      );
    const availabilityAfterReset = await pos.listKdsProductAvailability(
      identity.id,
      organizationA.id,
      unitA.id,
    );
    const resetProduct = availabilityAfterReset.products.find(
      (candidate) => candidate.productId === multiProduct.id,
    );
    assert.equal(resetProduct?.status, "limited");
    assert.equal(resetProduct?.remainingQuantity, 2);
    assert.equal(resetProduct?.resetAt, null);
    assert.equal(
      (
        await database.db
          .select({ status: posKdsTickets.status })
          .from(posKdsTickets)
          .where(eq(posKdsTickets.id, firstMultiTicket.id))
          .limit(1)
      )[0]?.status,
      "pending",
    );
    await pos.blockKdsItem(
      identity.id,
      organizationA.id,
      unitA.id,
      firstMultiTicket.id,
      multiItem.id,
      "block-multi-item-0001",
      { code: "quality_check", reason: "Conferir risco de lactose" },
    );
    await assert.rejects(
      () =>
        pos.transitionKdsItem(
          identity.id,
          organizationA.id,
          unitA.id,
          firstMultiTicket.id,
          multiItem.id,
          "blocked-transition-0001",
          { state: "preparing" },
        ),
      (error: unknown) =>
        (error as { getResponse?: () => { code?: string } }).getResponse?.().code ===
        "KDS_ITEM_BLOCKED",
    );
    const blockedSnapshot = await pos.snapshotKds(organizationA.id, unitA.id);
    kdsReadModelSchema.parse(JSON.parse(JSON.stringify(blockedSnapshot)));
    assert.ok((blockedSnapshot.metrics as { blockedItems: number }).blockedItems >= 1);
    const blockedReadItem = (
      blockedSnapshot.items as {
        ticketId: string;
        item: { id: string };
        kds: { blocked: { active: boolean } };
      }[]
    ).find((entry) => entry.ticketId === firstMultiTicket.id && entry.item.id === multiItem.id);
    assert.equal(blockedReadItem?.kds.blocked.active, true);
    await pos.unblockKdsItem(
      identity.id,
      organizationA.id,
      unitA.id,
      firstMultiTicket.id,
      multiItem.id,
      "unblock-multi-item-0001",
      { reason: "Conferência concluída" },
    );
    const attention = [
      { noteId: "allergy" as const, revision: kdsAttentionRevision("allergy", "Sem lactose") },
      {
        noteId: "notes" as const,
        revision: kdsAttentionRevision("notes", "Finalizar sem manteiga"),
      },
    ];
    for (const ticket of [firstMultiTicket, secondMultiTicket]) {
      for (const note of attention) {
        await pos.acknowledgeKdsAttention(
          identity.id,
          organizationA.id,
          unitA.id,
          ticket.id,
          multiItem.id,
          `ack-${ticket.id}-${note.noteId}`,
          note,
        );
      }
    }
    const allergyAttention = attention[0];
    assert.ok(allergyAttention);
    const firstAcknowledgement = await pos.acknowledgeKdsAttention(
      identity.id,
      organizationA.id,
      unitA.id,
      firstMultiTicket.id,
      multiItem.id,
      "ack-multi-repeat-0001",
      allergyAttention,
    );
    const acknowledgementRows = await database.db
      .select()
      .from(posKdsAttentionAcknowledgements)
      .where(
        and(
          eq(posKdsAttentionAcknowledgements.organizationId, organizationA.id),
          eq(posKdsAttentionAcknowledgements.unitId, unitA.id),
          eq(posKdsAttentionAcknowledgements.ticketId, firstMultiTicket.id),
          eq(posKdsAttentionAcknowledgements.orderItemId, multiItem.id),
          eq(posKdsAttentionAcknowledgements.noteId, "allergy"),
        ),
      );
    assert.equal(acknowledgementRows.length, 1);
    assert.equal(
      firstAcknowledgement.acknowledgedAt,
      acknowledgementRows[0]?.acknowledgedAt.toISOString(),
    );
    for (const ticket of [firstMultiTicket, secondMultiTicket]) {
      await pos.transitionKds(
        identity.id,
        organizationA.id,
        unitA.id,
        ticket.id,
        `prepare-multi-${ticket.id}`,
        { state: "preparing" },
      );
    }
    await assert.rejects(
      () =>
        pos.rerouteKdsItem(
          identity.id,
          organizationA.id,
          unitA.id,
          firstMultiTicket.id,
          multiItem.id,
          "reroute-collision-0001",
          { stationId: secondStation.id, reason: "Teste de colisão multi praça" },
        ),
      (error: unknown) =>
        (error as { getResponse?: () => { code?: string } }).getResponse?.().code ===
        "KDS_TARGET_ALREADY_ASSIGNED",
    );
    await pos.transitionKdsItem(
      identity.id,
      organizationA.id,
      unitA.id,
      firstMultiTicket.id,
      multiItem.id,
      "ready-first-multi-0001",
      { state: "ready" },
    );
    const [multiItemAfterFirstReady] = await database.db
      .select({ status: posOrderItems.status })
      .from(posOrderItems)
      .where(
        and(
          eq(posOrderItems.organizationId, organizationA.id),
          eq(posOrderItems.unitId, unitA.id),
          eq(posOrderItems.id, multiItem.id),
        ),
      );
    assert.equal(multiItemAfterFirstReady?.status, "preparing");
    const createdBatch = await pos.createKdsBatch(
      identity.id,
      organizationA.id,
      unitA.id,
      "create-batch-multi-0001",
      { stationId: secondStation.id, productId: multiProduct.id, maxAssignments: 1 },
    );
    const batchId = createdBatch.batchId as string;
    assert.equal(createdBatch.state, "active");
    const snapshotWithBatch = await pos.snapshotKds(organizationA.id, unitA.id);
    assert.equal(
      (snapshotWithBatch.batches as { batchId: string }[]).some(
        (candidate) => candidate.batchId === batchId,
      ),
      true,
    );
    const completedBatch = await pos.completeKdsBatch(
      identity.id,
      organizationA.id,
      unitA.id,
      batchId,
      "complete-batch-multi-0001",
      { reason: "Lote conferido" },
    );
    assert.equal(completedBatch.state, "completed");
    const [multiItemReady] = await database.db
      .select({ status: posOrderItems.status })
      .from(posOrderItems)
      .where(eq(posOrderItems.id, multiItem.id));
    assert.equal(multiItemReady?.status, "ready");
    const snapshotAfterBatch = await pos.snapshotKds(organizationA.id, unitA.id);
    assert.equal(
      (snapshotAfterBatch.batches as { batchId: string }[]).some(
        (candidate) => candidate.batchId === batchId,
      ),
      false,
    );
    const readyNotifications = await database.db
      .select({ payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.topic, "pos.order.ready_notification_requested"),
          eq(outboxEvents.aggregateType, "order"),
          eq(outboxEvents.aggregateId, multiOrder.id),
        ),
      );
    assert.equal(readyNotifications.length, 1);
    assert.deepEqual((readyNotifications[0]?.payload as { channels: string[] }).channels, [
      "waiter",
    ]);
    const analytics = await pos.kdsAnalytics(identity.id, organizationA.id, unitA.id, {
      windowHours: 168,
    });
    kdsAnalyticsResponseSchema.parse(JSON.parse(JSON.stringify(analytics)));
    assert.ok(analytics.sampleSize >= 3);
    assert.ok(analytics.counts.blocked >= 1);
    assert.equal(analytics.prep.p50Minutes, null);
    assert.equal(analytics.prep.p90Minutes, null);

    const [multiStockBeforeCancel] = await database.db
      .select({ soldToday: posProductAvailability.soldToday })
      .from(posProductAvailability)
      .where(
        and(
          eq(posProductAvailability.unitId, unitA.id),
          eq(posProductAvailability.productId, multiProduct.id),
        ),
      );
    assert.ok(multiStockBeforeCancel);
    const cancelMultiOrderResult = await pos.createOrder(
      identity.id,
      organizationA.id,
      unitA.id,
      tabId,
      "create-order-cancel-multi-0001",
      { items: [{ productId: multiProduct.id, quantity: 2, modifierOptionIds: [] }] },
    );
    const cancelMultiOrder = cancelMultiOrderResult.order as { id: string };
    const cancelMultiItem = (cancelMultiOrderResult.items as { id: string }[])[0];
    assert.ok(cancelMultiItem);
    const cancelMultiSent = await pos.sendOrder(
      identity.id,
      organizationA.id,
      unitA.id,
      cancelMultiOrder.id,
      "send-order-cancel-multi-0001",
    );
    const cancelMultiTicketIds = cancelMultiSent.ticketIds as string[];
    const cancelMultiSourceTicketId = cancelMultiTicketIds[0];
    assert.ok(cancelMultiSourceTicketId);
    await pos.cancelKdsTicket(
      identity.id,
      organizationA.id,
      unitA.id,
      cancelMultiSourceTicketId,
      "cancel-ticket-multi-0001",
      {
        approval: {
          approverMembershipId: membership.id,
          pin: "1234",
          reason: "Cancelamento multi praça integrado",
        },
      },
    );
    const canceledMultiAssignments = await database.db
      .select({ status: posKdsTicketItems.status })
      .from(posKdsTicketItems)
      .where(eq(posKdsTicketItems.orderItemId, cancelMultiItem.id));
    assert.equal(canceledMultiAssignments.length, 2);
    assert.ok(canceledMultiAssignments.every((assignment) => assignment.status === "canceled"));
    const canceledMultiTickets = await database.db
      .select({ status: posKdsTickets.status })
      .from(posKdsTickets)
      .where(inArray(posKdsTickets.id, cancelMultiTicketIds));
    assert.ok(canceledMultiTickets.every((candidate) => candidate.status === "canceled"));
    const [multiStockAfterCancel] = await database.db
      .select({ soldToday: posProductAvailability.soldToday })
      .from(posProductAvailability)
      .where(
        and(
          eq(posProductAvailability.unitId, unitA.id),
          eq(posProductAvailability.productId, multiProduct.id),
        ),
      );
    assert.equal(multiStockAfterCancel?.soldToday, multiStockBeforeCancel.soldToday);

    const rerouteOrderResult = await pos.createOrder(
      identity.id,
      organizationA.id,
      unitA.id,
      tabId,
      "create-order-reroute-0001",
      {
        items: [
          {
            productId: rerouteProduct.id,
            quantity: 1,
            modifierOptionIds: [],
            notes: "Manter crocante",
          },
          { productId: targetProduct.id, quantity: 1, modifierOptionIds: [] },
        ],
      },
    );
    const rerouteOrder = rerouteOrderResult.order as { id: string };
    const rerouteItems = rerouteOrderResult.items as { id: string; productId: string }[];
    const rerouteItem = rerouteItems.find((candidate) => candidate.productId === rerouteProduct.id);
    const targetItem = rerouteItems.find((candidate) => candidate.productId === targetProduct.id);
    assert.ok(rerouteItem && targetItem);
    await pos.sendOrder(
      identity.id,
      organizationA.id,
      unitA.id,
      rerouteOrder.id,
      "send-order-reroute-0001",
    );
    const rerouteTickets = await database.db
      .select({ id: posKdsTickets.id, stationId: posKdsTickets.stationId })
      .from(posKdsTickets)
      .where(eq(posKdsTickets.orderId, rerouteOrder.id));
    const sourceRerouteTicket = rerouteTickets.find(
      (candidate) => candidate.stationId === rerouteSourceStation.id,
    );
    const targetRerouteTicket = rerouteTickets.find(
      (candidate) => candidate.stationId === secondStation.id,
    );
    assert.ok(sourceRerouteTicket && targetRerouteTicket);
    for (const ticket of [sourceRerouteTicket, targetRerouteTicket]) {
      await pos.transitionKds(
        identity.id,
        organizationA.id,
        unitA.id,
        ticket.id,
        `prepare-reroute-${ticket.id}`,
        { state: "preparing" },
      );
    }
    await pos.acknowledgeKdsAttention(
      identity.id,
      organizationA.id,
      unitA.id,
      sourceRerouteTicket.id,
      rerouteItem.id,
      "ack-reroute-note-0001",
      { noteId: "notes", revision: kdsAttentionRevision("notes", "Manter crocante") },
    );
    await pos.transitionKdsItem(
      identity.id,
      organizationA.id,
      unitA.id,
      targetRerouteTicket.id,
      targetItem.id,
      "ready-target-reroute-0001",
      { state: "ready" },
    );
    const rerouteBatch = await pos.createKdsBatch(
      identity.id,
      organizationA.id,
      unitA.id,
      "create-reroute-batch-0001",
      {
        stationId: rerouteSourceStation.id,
        productId: rerouteProduct.id,
        maxAssignments: 1,
      },
    );
    const rerouteBatchId = rerouteBatch.batchId as string;
    await pos.cancelKdsBatch(
      identity.id,
      organizationA.id,
      unitA.id,
      rerouteBatchId,
      "cancel-reroute-batch-0001",
      { reason: "Rota será alterada" },
    );
    await database.db
      .update(posProductionStations)
      .set({ active: false })
      .where(eq(posProductionStations.id, rerouteSourceStation.id));
    const rerouted = await pos.rerouteKdsItem(
      identity.id,
      organizationA.id,
      unitA.id,
      sourceRerouteTicket.id,
      rerouteItem.id,
      "reroute-after-release-0001",
      { stationId: secondStation.id, reason: "Praça de origem indisponível" },
    );
    assert.equal(rerouted.targetTicketId, targetRerouteTicket.id);
    const [reopenedTarget] = await database.db
      .select({ status: posKdsTickets.status, readyAt: posKdsTickets.readyAt })
      .from(posKdsTickets)
      .where(eq(posKdsTickets.id, targetRerouteTicket.id));
    assert.equal(reopenedTarget?.status, "preparing");
    assert.equal(reopenedTarget?.readyAt, null);
    const [reroutedAttention] = await database.db
      .select({ ticketId: posKdsAttentionAcknowledgements.ticketId })
      .from(posKdsAttentionAcknowledgements)
      .where(eq(posKdsAttentionAcknowledgements.orderItemId, rerouteItem.id));
    assert.equal(reroutedAttention?.ticketId, targetRerouteTicket.id);
    const [reroutedBatchHistory] = await database.db
      .select({
        ticketId: posKdsBatchAssignments.ticketId,
        releasedAt: posKdsBatchAssignments.releasedAt,
      })
      .from(posKdsBatchAssignments)
      .where(eq(posKdsBatchAssignments.batchId, rerouteBatchId));
    assert.equal(reroutedBatchHistory?.ticketId, targetRerouteTicket.id);
    assert.ok(reroutedBatchHistory?.releasedAt);
    const [reroutedLegacyItem] = await database.db
      .select({ stationId: posOrderItems.stationId })
      .from(posOrderItems)
      .where(eq(posOrderItems.id, rerouteItem.id));
    assert.equal(reroutedLegacyItem?.stationId, secondStation.id);
    await assert.rejects(
      () =>
        pos.rerouteKdsItem(
          identity.id,
          organizationA.id,
          unitA.id,
          targetRerouteTicket.id,
          rerouteItem.id,
          "reroute-inactive-target-0001",
          { stationId: inactiveStation.id, reason: "Destino inativo" },
        ),
      (error: unknown) =>
        (error as { getResponse?: () => { code?: string } }).getResponse?.().code ===
        "STATION_NOT_ACTIVE",
    );
    await database.db
      .update(posProductionStations)
      .set({ active: true })
      .where(eq(posProductionStations.id, rerouteSourceStation.id));

    const [freeTable, occupiedTable] = await database.db
      .insert(posDiningTables)
      .values([
        {
          organizationId: organizationA.id,
          unitId: unitA.id,
          roomId: room.id,
          label: "02",
        },
        {
          organizationId: organizationA.id,
          unitId: unitA.id,
          roomId: room.id,
          label: "03",
        },
      ])
      .returning();
    assert.ok(freeTable && occupiedTable);

    const occupiedOpened = await pos.openTab(
      identity.id,
      organizationA.id,
      unitA.id,
      "open-tab-0002",
      { tableId: occupiedTable.id, guestCount: 1 },
    );
    const occupiedTabId = (occupiedOpened.tab as { id: string }).id;
    await assert.rejects(() =>
      pos.createOrder(identity.id, organizationA.id, unitA.id, occupiedTabId, "create-order-0001", {
        items: [{ productId: product.id, quantity: 2, modifierOptionIds: [] }],
      }),
    );
    await assert.rejects(() =>
      pos.createServiceCall(
        identity.id,
        organizationA.id,
        unitA.id,
        table.id,
        "service-call-mismatch-0001",
        { kind: "assistance", tabId: occupiedTabId, slaMinutes: 3 },
      ),
    );
    await pos.createOrder(
      identity.id,
      organizationA.id,
      unitA.id,
      occupiedTabId,
      "create-order-0002",
      { items: [{ productId: product.id, quantity: 1, modifierOptionIds: [] }] },
    );

    const occupiedAndFree = await pos.groupTables(
      identity.id,
      organizationA.id,
      unitA.id,
      "group-tables-0001",
      {
        tableIds: [table.id, freeTable.id],
        anchorTableId: table.id,
        mode: "single_tab",
        targetTabId: tabId,
        responsibleIdentityId: supportIdentity.id,
      },
    );
    assert.equal((occupiedAndFree.group as { primaryTabId: string }).primaryTabId, tabId);
    let groupedFloor = await pos.listFloor(identity.id, organizationA.id, unitA.id);
    assert.equal(
      groupedFloor.tables.find((candidate) => candidate.id === freeTable.id)?.status,
      "occupied",
    );
    await assert.rejects(() =>
      pos.openTab(identity.id, organizationA.id, unitA.id, "open-group-secondary-0001", {
        tableId: freeTable.id,
        guestCount: 1,
      }),
    );

    await pos.groupTables(identity.id, organizationA.id, unitA.id, "group-tables-0002", {
      tableIds: [table.id, freeTable.id, occupiedTable.id],
      anchorTableId: table.id,
      mode: "physical_only",
    });
    groupedFloor = await pos.listFloor(identity.id, organizationA.id, unitA.id);
    assert.equal(
      groupedFloor.openTabs.filter((open) =>
        [table.id, occupiedTable.id].includes(open.tableId ?? ""),
      ).length,
      2,
    );

    const unified = await pos.groupTables(
      identity.id,
      organizationA.id,
      unitA.id,
      "group-tables-0003",
      {
        tableIds: [table.id, freeTable.id, occupiedTable.id],
        anchorTableId: table.id,
        mode: "single_tab",
        targetTabId: tabId,
        responsibleIdentityId: supportIdentity.id,
      },
    );
    const unifiedGroupId = (unified.group as { id: string }).id;
    groupedFloor = await pos.listFloor(identity.id, organizationA.id, unitA.id);
    assert.equal(
      groupedFloor.openTabs.filter((open) =>
        [table.id, freeTable.id, occupiedTable.id].includes(open.tableId ?? ""),
      ).length,
      1,
    );
    assert.equal(groupedFloor.openTabs.find((open) => open.id === tabId)?.guestCount, 3);
    assert.equal(
      groupedFloor.openTabs.find((open) => open.id === tabId)?.responsibleIdentityId,
      supportIdentity.id,
    );
    const unifiedTab = await pos.getTab(identity.id, organizationA.id, unitA.id, tabId);
    assert.deepEqual(
      new Set(unifiedTab.orders.map((order) => order.originTableId)),
      new Set([table.id, occupiedTable.id]),
    );

    await pos.detachTableGroup(
      identity.id,
      organizationA.id,
      unitA.id,
      unifiedGroupId,
      "detach-table-0001",
      { tableId: freeTable.id },
    );
    groupedFloor = await pos.listFloor(identity.id, organizationA.id, unitA.id);
    assert.equal(
      groupedFloor.tables.find((candidate) => candidate.id === freeTable.id)?.status,
      "needs_cleaning",
    );
    await assert.rejects(() =>
      pos.dissolveTableGroup(
        identity.id,
        organizationA.id,
        unitA.id,
        unifiedGroupId,
        "dissolve-group-0001",
      ),
    );

    const [varandaTable] = await database.db
      .insert(posDiningTables)
      .values({
        organizationId: organizationA.id,
        unitId: unitA.id,
        roomId: room.id,
        label: "04",
      })
      .returning();
    assert.ok(varandaTable);
    await pos.createServiceSection(identity.id, organizationA.id, unitA.id, {
      name: "Praça principal",
      color: "#176B4D",
      serviceMode: "full_service",
      tableIds: [table.id, freeTable.id, occupiedTable.id],
      defaultResponsibleIdentityId: identity.id,
    });
    await pos.createServiceSection(identity.id, organizationA.id, unitA.id, {
      name: "Praça varanda",
      color: "#245D8C",
      serviceMode: "full_service",
      tableIds: [varandaTable.id],
      defaultResponsibleIdentityId: supportIdentity.id,
    });
    const openedShift = await pos.openOperationalShift(identity.id, organizationA.id, unitA.id, {
      label: "Jantar",
      serviceMode: "full_service",
      copyPreviousAssignments: true,
    });
    const shift = openedShift.shift as { id: string };
    const shiftSections = openedShift.sections as { id: string; name: string }[];
    const shiftSection = shiftSections.find((section) => section.name === "Praça principal");
    const targetShiftSection = shiftSections.find((section) => section.name === "Praça varanda");
    assert.ok(shiftSection && targetShiftSection);
    await pos.updateShiftSectionAssignment(
      identity.id,
      organizationA.id,
      unitA.id,
      shift.id,
      shiftSection.id,
      {
        tableIds: [table.id, freeTable.id, occupiedTable.id],
        primaryIdentityId: identity.id,
        supportIdentityIds: [],
      },
    );
    await pos.updateShiftSectionCoverage(
      supportIdentity.id,
      organizationA.id,
      unitA.id,
      shift.id,
      shiftSection.id,
      { active: true },
    );
    await pos.updateShiftSectionCoverage(
      supportIdentity.id,
      organizationA.id,
      unitA.id,
      shift.id,
      shiftSection.id,
      { active: true },
    );
    let coveredFloor = await pos.listFloor(identity.id, organizationA.id, unitA.id);
    assert.equal(
      coveredFloor.shiftSectionStaff.some(
        (row) =>
          row.shiftSectionId === shiftSection.id &&
          row.identityId === supportIdentity.id &&
          row.role === "support",
      ),
      true,
    );
    await pos.updateShiftSectionCoverage(
      supportIdentity.id,
      organizationA.id,
      unitA.id,
      shift.id,
      shiftSection.id,
      { active: false },
    );
    coveredFloor = await pos.listFloor(identity.id, organizationA.id, unitA.id);
    assert.equal(
      coveredFloor.shiftSectionStaff.some(
        (row) => row.shiftSectionId === shiftSection.id && row.identityId === supportIdentity.id,
      ),
      false,
    );
    await pos.transferShiftTable(identity.id, organizationA.id, unitA.id, shift.id, table.id, {
      targetShiftSectionId: targetShiftSection.id,
      durationMinutes: 30,
      transferOpenTab: true,
      reason: "Grupo cobrindo a varanda",
    });
    const transferredGroupFloor = await pos.listFloor(identity.id, organizationA.id, unitA.id);
    assert.deepEqual(
      new Set(
        transferredGroupFloor.shiftTableTransfers
          .filter((row) => [table.id, occupiedTable.id].includes(row.tableId))
          .map((row) => row.tableId),
      ),
      new Set([table.id, occupiedTable.id]),
    );
    await pos.endShiftTableTransfer(identity.id, organizationA.id, unitA.id, shift.id, table.id);
    assert.equal(
      (await pos.listFloor(identity.id, organizationA.id, unitA.id)).shiftTableTransfers.some(
        (row) => [table.id, occupiedTable.id].includes(row.tableId),
      ),
      false,
    );
    await pos.updateTableTurnover(identity.id, organizationA.id, unitA.id, freeTable.id, {
      status: "cleaning",
    });
    await pos.updateTableTurnover(identity.id, organizationA.id, unitA.id, freeTable.id, {
      status: "available",
    });
    const transferredTab = await pos.openTab(
      identity.id,
      organizationA.id,
      unitA.id,
      "transfer-tab-0001",
      { tableId: freeTable.id, guestCount: 2 },
    );
    await pos.transferShiftTable(identity.id, organizationA.id, unitA.id, shift.id, freeTable.id, {
      targetShiftSectionId: targetShiftSection.id,
      durationMinutes: 60,
      transferOpenTab: true,
      reason: "Cobertura temporária da varanda",
    });
    const transferredFloor = await pos.listFloor(identity.id, organizationA.id, unitA.id);
    assert.equal(transferredFloor.shiftTableTransfers[0]?.tableId, freeTable.id);
    assert.equal(
      transferredFloor.openTabs.find(
        (candidate) => candidate.id === (transferredTab.tab as { id: string }).id,
      )?.responsibleIdentityId,
      supportIdentity.id,
    );
    await pos.endShiftTableTransfer(
      identity.id,
      organizationA.id,
      unitA.id,
      shift.id,
      freeTable.id,
    );
    assert.equal(
      (await pos.listFloor(identity.id, organizationA.id, unitA.id)).shiftTableTransfers.length,
      0,
    );
    await pos.updateShiftLayout(identity.id, organizationA.id, unitA.id, shift.id, {
      tables: [{ tableId: table.id, roomId: room.id, x: 320, y: 220 }],
    });
    const shiftedFloor = await pos.listFloor(identity.id, organizationA.id, unitA.id);
    assert.deepEqual(
      shiftedFloor.shiftTableLayouts.map(({ tableId, roomId, x, y }) => ({
        tableId,
        roomId,
        x,
        y,
      })),
      [{ tableId: table.id, roomId: room.id, x: 320, y: 220 }],
    );
    const counterOpened = await pos.openTab(
      identity.id,
      organizationA.id,
      unitA.id,
      "counter-open-0001",
      {
        fulfillmentType: "pickup",
        customerName: "Cliente teste",
        customerPhone: "+55 11 99999-9999",
        guestCount: 1,
      },
    );
    const counterTab = counterOpened.tab as { id: string; displayNumber: number; version: number };
    assert.ok(counterTab.displayNumber > 0);
    const updatedCounter = await pos.updateTab(
      identity.id,
      organizationA.id,
      unitA.id,
      counterTab.id,
      {
        expectedVersion: counterTab.version,
        promisedAt: "2026-08-15T22:00:00.000Z",
      },
    );
    await assert.rejects(() =>
      pos.updateTab(identity.id, organizationA.id, unitA.id, counterTab.id, {
        expectedVersion: counterTab.version,
        customerName: "Versão antiga",
      }),
    );
    const counterOrder = await pos.createOrder(
      identity.id,
      organizationA.id,
      unitA.id,
      counterTab.id,
      "counter-order-0001",
      {
        items: [
          {
            productId: product.id,
            quantity: 1,
            modifierOptionIds: [],
            seatNumber: 1,
            course: "main",
            allergyNote: "Sem lactose",
          },
        ],
      },
    );
    const counterItem = (counterOrder.items as { id: string }[])[0];
    assert.ok(counterItem);
    await pos.moveItems(identity.id, organizationA.id, unitA.id, counterTab.id, "move-item-0001", {
      targetTabId: tabId,
      items: [{ orderItemId: counterItem.id, quantity: 1 }],
    });
    await pos.recordPayment(supportIdentity.id, organizationA.id, unitA.id, tabId, "payment-0001", {
      method: "pix",
      amountCents: 100,
      reference: "e2e",
    });
    const queuedPrint = await pos.createPrintJob(
      identity.id,
      organizationA.id,
      unitA.id,
      tabId,
      "print-payment-0001",
      {
        documentType: "payment_statement",
        copies: 1,
        terminalId: "caixa-01",
      },
    );
    const printJobId = (queuedPrint.printJob as { id: string }).id;
    assert.equal(
      (queuedPrint.printJob as { payload: Record<string, unknown> }).payload.establishmentName,
      "Restaurante Pilot A",
    );
    const replayedPrint = await pos.createPrintJob(
      identity.id,
      organizationA.id,
      unitA.id,
      tabId,
      "print-payment-0001",
      {
        documentType: "payment_statement",
        copies: 1,
        terminalId: "caixa-01",
      },
    );
    assert.equal(replayedPrint.idempotentReplay, true);
    assert.equal(
      (
        await pos.listPrintJobs(identity.id, organizationA.id, unitA.id, {
          tabId,
          status: "queued",
          terminalId: "caixa-01",
          limit: 100,
        })
      ).some((job) => job.id === printJobId),
      true,
    );
    await pos.updatePrintJobStatus(
      identity.id,
      organizationA.id,
      unitA.id,
      printJobId,
      "print-start-0001",
      { status: "printing", printerId: "termica-01" },
    );
    await pos.updatePrintJobStatus(
      identity.id,
      organizationA.id,
      unitA.id,
      printJobId,
      "print-failed-0001",
      { status: "failed", error: "Impressora sem papel" },
    );
    await pos.retryPrintJob(
      identity.id,
      organizationA.id,
      unitA.id,
      printJobId,
      "print-retry-0001",
      {},
    );
    await pos.updatePrintJobStatus(
      identity.id,
      organizationA.id,
      unitA.id,
      printJobId,
      "print-start-0002",
      { status: "printing" },
    );
    await pos.updatePrintJobStatus(
      identity.id,
      organizationA.id,
      unitA.id,
      printJobId,
      "print-done-0001",
      { status: "printed" },
    );
    const reprint = await pos.reprintJob(
      identity.id,
      organizationA.id,
      unitA.id,
      printJobId,
      "print-reprint-0001",
      { reason: "Cliente solicitou segunda via" },
    );
    assert.equal((reprint.printJob as { reprintOfJobId: string }).reprintOfJobId, printJobId);
    await assert.rejects(() =>
      pos.createPrintJob(identity.id, organizationA.id, unitA.id, tabId, "print-final-open-0001", {
        documentType: "final_receipt",
        copies: 1,
      }),
    );
    await pos.notifyReady(
      identity.id,
      organizationA.id,
      unitA.id,
      counterTab.id,
      "notify-ready-0001",
    );
    const currentCounter = (updatedCounter.tab as { version: number }).version;
    await pos.claimTab(identity.id, organizationA.id, unitA.id, counterTab.id, {
      expectedVersion: currentCounter + 1,
      responsibleIdentityId: identity.id,
      reason: "Cobertura do balcão",
    });

    const createdCall = await pos.createServiceCall(
      identity.id,
      organizationA.id,
      unitA.id,
      table.id,
      "service-call-0001",
      { kind: "bill", tabId, slaMinutes: 2 },
    );
    const callId = (createdCall.call as { id: string }).id;
    await pos.transitionServiceCall(
      identity.id,
      organizationA.id,
      unitA.id,
      callId,
      "acknowledged",
      "service-call-ack-0001",
    );
    await pos.transitionServiceCall(
      identity.id,
      organizationA.id,
      unitA.id,
      callId,
      "resolved",
      "service-call-resolve-0001",
    );
    const finalFloor = await pos.listFloor(identity.id, organizationA.id, unitA.id);
    assert.equal(
      finalFloor.serviceCalls.some((call) => call.id === callId),
      false,
    );
    await assert.rejects(() =>
      pos.closeOperationalShift(identity.id, organizationA.id, unitA.id, shift.id, {
        acknowledgeOpenTabs: false,
      }),
    );
    const closedShift = await pos.closeOperationalShift(
      identity.id,
      organizationA.id,
      unitA.id,
      shift.id,
      {
        acknowledgeOpenTabs: true,
        handoverAssignments: [
          {
            sourceResponsibleIdentityId: identity.id,
            targetResponsibleIdentityId: supportIdentity.id,
          },
        ],
        reason: "Passagem para equipe noturna",
      },
    );
    assert.ok(closedShift.handover.openTabs > 0);
    assert.equal(
      (await pos.listFloor(identity.id, organizationA.id, unitA.id)).openTabs.every(
        (open) => open.responsibleIdentityId === supportIdentity.id,
      ),
      true,
    );
  } finally {
    await database.onModuleDestroy();
  }
});
