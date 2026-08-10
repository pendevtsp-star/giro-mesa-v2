import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  deviceEnrollments,
  hubHeartbeats,
  identities,
  memberships,
  operationalCommands,
  organizations,
  posCatalogCategories,
  posDiningRooms,
  posDiningTables,
  posKdsTickets,
  posOperationApprovals,
  posOrderItems,
  posOrders,
  posProductAvailability,
  posProductionStations,
  posProductPrices,
  posProductStations,
  posProducts,
  posTabs,
  roleBindings,
  units,
} from "@giromesa/db";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { PilotPosService } from "../pilot-operations/pilot-pos.service.js";
import { OperationalSnapshotService } from "./operational-snapshot.service.js";
import { stableOperationalId } from "./stable-operational-id.js";
import { SyncService } from "./sync.service.js";
import { SyncPilotService } from "./sync-pilot.service.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

it("synchronizes an isolated tenant-safe and idempotent Cloud/Edge flow in PostgreSQL", async (context) => {
  const databaseUrl = process.env.SYNC_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("SYNC_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  try {
    const pos = new PilotPosService(database, new ScopeService(database));
    const pilot = new SyncPilotService(pos);
    const sync = new SyncService(database, pilot, new OperationalSnapshotService(database));
    const suffix = randomBytes(6).toString("hex");
    const [organizationA, organizationB] = await database.db
      .insert(organizations)
      .values([
        {
          legalName: `Sync A ${suffix}`,
          tradeName: `Sync A ${suffix}`,
          document: `1${Date.now()}`.slice(-14),
          billingState: "active" as const,
        },
        {
          legalName: `Sync B ${suffix}`,
          tradeName: `Sync B ${suffix}`,
          document: `2${Date.now()}`.slice(-14),
          billingState: "active" as const,
        },
      ])
      .returning();
    assert.ok(organizationA && organizationB);
    const [unitA, unitB] = await database.db
      .insert(units)
      .values([
        { organizationId: organizationA.id, name: "Sync Unit A" },
        { organizationId: organizationB.id, name: "Sync Unit B" },
      ])
      .returning();
    assert.ok(unitA && unitB);
    const [identity] = await database.db
      .insert(identities)
      .values({ email: `sync-${suffix}@example.test`, displayName: "Sync Owner" })
      .returning();
    assert.ok(identity);
    const [membership] = await database.db
      .insert(memberships)
      .values({ identityId: identity.id, organizationId: organizationA.id, status: "active" })
      .returning();
    assert.ok(membership);
    await database.db.insert(roleBindings).values({ membershipId: membership.id, role: "owner" });

    const keyA = randomBytes(32).toString("base64url");
    const keyB = randomBytes(32).toString("base64url");
    const [hubA, hubB] = await database.db
      .insert(deviceEnrollments)
      .values([
        {
          organizationId: organizationA.id,
          unitId: unitA.id,
          label: "Hub A",
          syncKeyHash: hash(keyA),
        },
        {
          organizationId: organizationB.id,
          unitId: unitB.id,
          label: "Hub B",
          syncKeyHash: hash(keyB),
        },
      ])
      .returning();
    assert.ok(hubA && hubB);
    assert.equal(hubA.syncKeyHash, hash(keyA));
    assert.notEqual(hubA.syncKeyHash, keyA);

    const eventId = randomUUID();
    const terminalId = randomUUID();
    const event = {
      id: eventId,
      actorId: identity.id,
      deviceId: terminalId,
      idempotencyKey: `sync-event-${suffix}`,
      type: "order.created",
      payload: { orderId: randomUUID(), totalCents: 2_500 },
      version: 1,
      occurredAt: new Date().toISOString(),
    };
    const batch = {
      protocolVersion: 1 as const,
      hubVersion: "2.0.0",
      metadata: {},
      acknowledgedCommandIds: [],
      events: [event],
    };
    const first = await sync.synchronize(keyA, batch);
    const replay = await sync.synchronize(keyA, batch);
    assert.notEqual(terminalId, hubA.id);
    assert.deepEqual(first.acceptedEventIds, [eventId]);
    assert.deepEqual(replay.acceptedEventIds, [eventId]);
    assert.equal(
      (
        await database.db
          .select()
          .from(operationalCommands)
          .where(eq(operationalCommands.id, eventId))
      ).length,
      1,
    );

    const conflict = await sync.synchronize(keyA, {
      ...batch,
      events: [{ ...event, id: randomUUID(), type: "order.changed" }],
    });
    assert.equal(conflict.rejectedEvents[0]?.code, "IDEMPOTENCY_CONFLICT");
    const crossTenant = await sync.synchronize(keyB, { ...batch, events: [event] });
    assert.equal(crossTenant.rejectedEvents[0]?.code, "ACTOR_SCOPE_DENIED");

    const [category] = await database.db
      .insert(posCatalogCategories)
      .values({ organizationId: organizationA.id, name: "Pratos", slug: `pratos-${suffix}` })
      .returning();
    const [station] = await database.db
      .insert(posProductionStations)
      .values({
        organizationId: organizationA.id,
        unitId: unitA.id,
        name: "Cozinha",
        code: `cozinha-${suffix}`,
      })
      .returning();
    assert.ok(category && station);
    const [product] = await database.db
      .insert(posProducts)
      .values({ organizationId: organizationA.id, categoryId: category.id, name: "Executivo" })
      .returning();
    assert.ok(product);
    await database.db.insert(posProductPrices).values({
      organizationId: organizationA.id,
      unitId: unitA.id,
      productId: product.id,
      priceCents: 2_500,
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
      .values({ organizationId: organizationA.id, unitId: unitA.id, roomId: room.id, label: "01" })
      .returning();
    assert.ok(table);
    const [transferTable] = await database.db
      .insert(posDiningTables)
      .values({ organizationId: organizationA.id, unitId: unitA.id, roomId: room.id, label: "02" })
      .returning();
    assert.ok(transferTable);

    const commandBase = {
      actorId: identity.id,
      deviceId: terminalId,
      version: 1,
      occurredAt: new Date().toISOString(),
    };
    const openId = randomUUID();
    const orderId = randomUUID();
    const sendId = randomUUID();
    const ticketId = stableOperationalId(sendId, "kds-ticket", station.id);
    const transitionId = randomUUID();
    const operationalBatch = {
      ...batch,
      events: [
        {
          ...commandBase,
          id: openId,
          idempotencyKey: `offline-open-${suffix}`,
          type: "pos.tab.open_requested",
          payload: {
            kind: "pilot.mutation",
            action: "open-tab",
            data: { body: { tableId: table.id, guestCount: 2 } },
          },
        },
        {
          ...commandBase,
          id: orderId,
          idempotencyKey: `offline-order-${suffix}`,
          type: "pos.order.create_requested",
          payload: {
            kind: "pilot.mutation",
            action: "create-order",
            data: {
              tabId: openId,
              body: {
                items: [{ productId: product.id, quantity: 2, modifierOptionIds: [] }],
              },
            },
          },
        },
        {
          ...commandBase,
          id: sendId,
          idempotencyKey: `offline-send-${suffix}`,
          type: "pos.order.send_requested",
          payload: {
            kind: "pilot.mutation",
            action: "send-order",
            data: { orderId },
          },
        },
        {
          ...commandBase,
          id: transitionId,
          idempotencyKey: `offline-kds-${suffix}`,
          type: "pos.kds.transition_requested",
          payload: {
            kind: "pilot.mutation",
            action: "transition-kds",
            data: { ticketId, state: "preparing" },
          },
        },
      ],
    };
    const applied = await sync.synchronize(keyA, operationalBatch);
    const appliedReplay = await sync.synchronize(keyA, operationalBatch);
    assert.deepEqual(
      applied.acceptedEventIds,
      operationalBatch.events.map((item) => item.id),
    );
    assert.deepEqual(
      appliedReplay.acceptedEventIds,
      operationalBatch.events.map((item) => item.id),
    );
    assert.equal(
      (await database.db.select().from(posTabs).where(eq(posTabs.id, openId))).length,
      1,
    );
    assert.equal(
      (await database.db.select().from(posOrders).where(eq(posOrders.id, orderId))).length,
      1,
    );
    assert.equal(
      (await database.db.select().from(posKdsTickets).where(eq(posKdsTickets.id, ticketId))).length,
      1,
    );
    assert.equal(applied.snapshot.tabDetails[openId]?.orders[0]?.id, orderId);
    assert.equal(applied.snapshot.kds.tickets[0]?.id, ticketId);

    await pos.setManagerPin(identity.id, organizationA.id, unitA.id, { pin: "1234" });
    const itemId = stableOperationalId(orderId, "order-item", "0");
    const transferId = randomUUID();
    const splitId = randomUUID();
    const splitOrderId = stableOperationalId(splitId, "split-order", "");
    const movedItemId = stableOperationalId(splitId, "split-item", itemId);
    const mergeId = randomUUID();
    const serviceChargeId = randomUUID();
    const tipId = randomUUID();
    const discountId = randomUUID();
    const cancelId = randomUUID();
    const advancedBatch = {
      ...batch,
      events: [
        {
          ...commandBase,
          id: transferId,
          idempotencyKey: `offline-transfer-${suffix}`,
          type: "pos.tab.transfer_requested",
          payload: {
            kind: "pilot.mutation",
            action: "transfer-tab",
            data: {
              tabId: openId,
              body: { tableId: transferTable.id, reason: "Troca de mesa" },
            },
          },
        },
        {
          ...commandBase,
          id: splitId,
          idempotencyKey: `offline-split-${suffix}`,
          type: "pos.tab.split_requested",
          payload: {
            kind: "pilot.mutation",
            action: "split-tab",
            data: {
              tabId: openId,
              body: {
                label: "Conta separada",
                items: [{ orderItemId: itemId, quantity: 1 }],
              },
            },
          },
        },
        {
          ...commandBase,
          id: mergeId,
          idempotencyKey: `offline-merge-${suffix}`,
          type: "pos.tabs.merge_requested",
          payload: {
            kind: "pilot.mutation",
            action: "merge-tabs",
            data: { body: { targetTabId: openId, sourceTabIds: [splitId] } },
          },
        },
        {
          ...commandBase,
          id: serviceChargeId,
          idempotencyKey: `offline-service-${suffix}`,
          type: "pos.tab.service_charge_requested",
          payload: {
            kind: "pilot.mutation",
            action: "service-charge",
            data: { tabId: openId, basisPoints: 1_000 },
          },
        },
        {
          ...commandBase,
          id: tipId,
          idempotencyKey: `offline-tip-${suffix}`,
          type: "pos.tab.tip_requested",
          payload: {
            kind: "pilot.mutation",
            action: "tip",
            data: { tabId: openId, tipCents: 300 },
          },
        },
        {
          ...commandBase,
          id: discountId,
          idempotencyKey: `offline-discount-${suffix}`,
          type: "pos.item.discount_requested",
          payload: {
            kind: "pilot.mutation",
            action: "discount-item",
            data: {
              itemId,
              body: {
                discountCents: 100,
                approval: {
                  approverMembershipId: membership.id,
                  pin: "1234",
                  reason: "Cortesia autorizada",
                },
              },
            },
          },
        },
        {
          ...commandBase,
          id: cancelId,
          idempotencyKey: `offline-cancel-${suffix}`,
          type: "pos.item.cancel_requested",
          payload: {
            kind: "pilot.mutation",
            action: "cancel-item",
            data: {
              itemId: movedItemId,
              approval: {
                approverMembershipId: membership.id,
                pin: "1234",
                reason: "Cancelamento autorizado",
              },
            },
          },
        },
      ],
    };
    const advanced = await sync.synchronize(keyA, advancedBatch);
    const advancedReplay = await sync.synchronize(keyA, advancedBatch);
    assert.deepEqual(
      advanced.acceptedEventIds,
      advancedBatch.events.map((item) => item.id),
    );
    assert.deepEqual(
      advancedReplay.acceptedEventIds,
      advancedBatch.events.map((item) => item.id),
    );
    assert.equal(
      (await database.db.select().from(posTabs).where(eq(posTabs.id, splitId))).length,
      1,
    );
    assert.equal(
      (await database.db.select().from(posOrders).where(eq(posOrders.id, splitOrderId))).length,
      1,
    );
    assert.equal(
      (await database.db.select().from(posOrderItems).where(eq(posOrderItems.id, movedItemId)))[0]
        ?.status,
      "canceled",
    );
    assert.equal(
      (
        await database.db
          .select()
          .from(posOperationApprovals)
          .where(eq(posOperationApprovals.id, stableOperationalId(discountId, "approval", "")))
      ).length,
      1,
    );
    const [storedDiscount] = await database.db
      .select({ payload: operationalCommands.payload })
      .from(operationalCommands)
      .where(eq(operationalCommands.id, discountId));
    assert.ok(storedDiscount);
    assert.equal(JSON.stringify(storedDiscount.payload).includes("1234"), false);
    assert.equal(advanced.snapshot.approvals.managers[0]?.membershipId, membership.id);
    assert.deepEqual(advanced.snapshot.approvals.actors[0], {
      identityId: identity.id,
      roles: ["owner"],
    });

    const conflictResult = await sync.synchronize(keyA, {
      ...batch,
      events: [
        {
          ...commandBase,
          id: randomUUID(),
          idempotencyKey: `offline-conflict-${suffix}`,
          type: "pos.kds.transition_requested",
          payload: {
            kind: "pilot.mutation",
            action: "transition-kds",
            data: { ticketId, state: "done" },
          },
        },
      ],
    });
    assert.equal(conflictResult.rejectedEvents[0]?.code, "INVALID_KDS_TRANSITION");

    const cloudCommand = await sync.enqueuePublicCommand({
      organizationId: organizationA.id,
      unitId: unitA.id,
      hubId: hubA.id,
      idempotencyKey: `public-command-${suffix}`,
      type: "place_order",
      payload: { table: "12", items: [{ sku: "burger", quantity: 1 }] },
    });
    const pulled = await sync.synchronize(keyA, { ...batch, events: [] });
    assert.equal(pulled.commands[0]?.id, cloudCommand.id);
    await sync.synchronize(keyA, {
      ...batch,
      events: [],
      acknowledgedCommandIds: [cloudCommand.id],
    });
    assert.equal((await sync.waitForAcknowledgement(cloudCommand, 250)).acknowledged, true);
    assert.equal(
      (await database.db.select().from(hubHeartbeats).where(eq(hubHeartbeats.unitId, unitA.id)))
        .length,
      1,
    );

    await database.db
      .update(deviceEnrollments)
      .set({ revokedAt: new Date() })
      .where(eq(deviceEnrollments.id, hubA.id));
    await assert.rejects(() => sync.synchronize(keyA, { ...batch, events: [] }));
    await assert.rejects(() =>
      sync.enqueuePublicCommand({
        organizationId: organizationA.id,
        unitId: unitA.id,
        hubId: hubA.id,
        idempotencyKey: `revoked-command-${suffix}`,
        type: "place_order",
        payload: { table: "12" },
      }),
    );
  } finally {
    await database.onModuleDestroy();
  }
});
