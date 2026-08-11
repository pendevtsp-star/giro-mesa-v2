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
import { PilotConflictException, SyncPilotService } from "./sync-pilot.service.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

it("synchronizes an isolated tenant-safe and idempotent Cloud/Edge flow in PostgreSQL", async (context) => {
  const databaseUrl = process.env.SYNC_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("SYNC_DATABASE_URL not configured");
    return;
  }
  const previousFingerprintVersion = process.env.COMMAND_FINGERPRINT_ACTIVE_KEY_VERSION;
  const previousFingerprintKeys = process.env.COMMAND_FINGERPRINT_KEYS;
  process.env.COMMAND_FINGERPRINT_ACTIVE_KEY_VERSION = "integration-v1";
  process.env.COMMAND_FINGERPRINT_KEYS = JSON.stringify({
    "integration-v1": Buffer.alloc(32, 7).toString("base64url"),
  });
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  try {
    const pos = new PilotPosService(database, new ScopeService(database));
    const pilot = new SyncPilotService(pos, database);
    const snapshots = new OperationalSnapshotService(database);
    const sync = new SyncService(database, pilot, snapshots);
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
    await database.db.insert(deviceEnrollments).values({
      id: terminalId,
      organizationId: organizationA.id,
      unitId: unitA.id,
      label: "Terminal A",
    });
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
    const crossTenant = await sync.synchronize(keyB, {
      ...batch,
      events: [{ ...event, deviceId: hubB.id }],
    });
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

    const openId = randomUUID();
    const occupancyEpoch = randomUUID();
    const disconnectedSnapshot = await snapshots.capture(organizationA.id, unitA.id);
    const capturedPrice = disconnectedSnapshot.catalog.prices.find(
      (price) => price.productId === product.id,
    );
    assert.ok(capturedPrice);
    await database.db
      .update(posProductPrices)
      .set({ priceCents: 3_000, updatedAt: new Date() })
      .where(eq(posProductPrices.productId, product.id));
    const resource = (
      type: "tab" | "table",
      id: string,
      epoch: string,
      version: number,
    ) => ({ type, id, occupancyEpoch: epoch, resourceVersion: version });
    const orderedCommand = (commandId: string, aggregateSequence: number, resourceVersion: number) => ({
      commandId,
      actorId: identity.id,
      deviceId: terminalId,
      aggregate: { type: "tab", id: openId },
      occupancyEpoch,
      resourceVersion,
      aggregateSequence,
      resourcePreconditions: [resource("tab", openId, occupancyEpoch, resourceVersion)],
      priceReferences: [],
      occurredAt: new Date().toISOString(),
    });
    const orderedBatchBase = {
      protocolVersion: 2 as const,
      hubVersion: "2.0.0",
      metadata: {},
      acknowledgedCommandIds: [],
    };
    const orderId = randomUUID();
    const sendId = randomUUID();
    const ticketId = stableOperationalId(sendId, "kds-ticket", station.id);
    const transitionId = randomUUID();
    const operationalBatch = {
      ...orderedBatchBase,
      events: [
        {
          ...orderedCommand(openId, 1, 0),
          resourcePreconditions: [
            resource("tab", openId, occupancyEpoch, 0),
            resource("table", table.id, table.occupancyEpoch, table.resourceVersion),
          ],
          idempotencyKey: `offline-open-${suffix}`,
          type: "pos.tab.open_requested",
          payload: {
            kind: "pilot.mutation",
            action: "open-tab",
            data: { body: { tableId: table.id, guestCount: 2 } },
          },
        },
        {
          ...orderedCommand(orderId, 2, 1),
          priceReferences: [
            {
              kind: "product" as const,
              entityId: product.id,
              priceRevision: capturedPrice.priceRevision,
              token: capturedPrice.priceReference,
            },
          ],
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
          ...orderedCommand(sendId, 3, 2),
          idempotencyKey: `offline-send-${suffix}`,
          type: "pos.order.send_requested",
          payload: {
            kind: "pilot.mutation",
            action: "send-order",
            data: { orderId },
          },
        },
        {
          ...orderedCommand(transitionId, 4, 3),
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
      operationalBatch.events.map((item) => item.commandId),
    );
    assert.deepEqual(
      appliedReplay.acceptedEventIds,
      operationalBatch.events.map((item) => item.commandId),
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
      (await database.db.select().from(posOrderItems).where(eq(posOrderItems.orderId, orderId)))[0]
        ?.unitPriceCents,
      2_500,
    );
    assert.equal(
      (await database.db.select().from(posKdsTickets).where(eq(posKdsTickets.id, ticketId))).length,
      1,
    );
    assert.equal(applied.snapshot.tabDetails[openId]?.orders[0]?.id, orderId);
    assert.equal(applied.snapshot.kds.tickets[0]?.id, ticketId);

    await pos.setManagerPin(identity.id, organizationA.id, unitA.id, { pin: "1234" });
    const itemId = stableOperationalId(orderId, "order-item", "0");
    await database.db
      .update(posDiningTables)
      .set({ resourceVersion: 1, updatedAt: new Date() })
      .where(eq(posDiningTables.id, transferTable.id));
    const staleSecondary = await sync.synchronize(keyA, {
      ...orderedBatchBase,
      events: [
        {
          ...orderedCommand(randomUUID(), 5, 4),
          resourcePreconditions: [
            resource("tab", openId, occupancyEpoch, 4),
            resource("table", table.id, table.occupancyEpoch, 1),
            resource("table", transferTable.id, transferTable.occupancyEpoch, 0),
          ].sort((left, right) => `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`)),
          idempotencyKey: `offline-stale-target-${suffix}`,
          type: "pos.tab.transfer_requested",
          payload: {
            kind: "pilot.mutation",
            action: "transfer-tab",
            data: { tabId: openId, body: { tableId: transferTable.id, reason: "Alvo stale" } },
          },
        },
      ],
    });
    assert.equal(staleSecondary.rejectedEvents[0]?.code, "RESOURCE_VERSION_CONFLICT");
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
      ...orderedBatchBase,
      events: [
        {
          ...orderedCommand(transferId, 6, 4),
          resourcePreconditions: [
            resource("tab", openId, occupancyEpoch, 4),
            resource("table", table.id, table.occupancyEpoch, 1),
            resource("table", transferTable.id, transferTable.occupancyEpoch, 1),
          ].sort((left, right) => `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`)),
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
          ...orderedCommand(splitId, 7, 5),
          resourcePreconditions: [
            resource("tab", openId, occupancyEpoch, 5),
            resource("tab", splitId, stableOperationalId(splitId, "occupancy-epoch", splitId), 0),
          ].sort((left, right) => `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`)),
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
          ...orderedCommand(mergeId, 8, 6),
          resourcePreconditions: [
            resource("tab", openId, occupancyEpoch, 6),
            resource("tab", splitId, stableOperationalId(splitId, "occupancy-epoch", splitId), 1),
            resource("table", transferTable.id, transferTable.occupancyEpoch, 2),
          ].sort((left, right) => `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`)),
          idempotencyKey: `offline-merge-${suffix}`,
          type: "pos.tabs.merge_requested",
          payload: {
            kind: "pilot.mutation",
            action: "merge-tabs",
            data: { body: { targetTabId: openId, sourceTabIds: [splitId] } },
          },
        },
        {
          ...orderedCommand(serviceChargeId, 9, 7),
          idempotencyKey: `offline-service-${suffix}`,
          type: "pos.tab.service_charge_requested",
          payload: {
            kind: "pilot.mutation",
            action: "service-charge",
            data: { tabId: openId, basisPoints: 1_000 },
          },
        },
        {
          ...orderedCommand(tipId, 10, 8),
          idempotencyKey: `offline-tip-${suffix}`,
          type: "pos.tab.tip_requested",
          payload: {
            kind: "pilot.mutation",
            action: "tip",
            data: { tabId: openId, tipCents: 300 },
          },
        },
        {
          ...orderedCommand(discountId, 11, 9),
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
          ...orderedCommand(cancelId, 12, 10),
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
      advancedBatch.events.map((item) => item.commandId),
    );
    assert.deepEqual(
      advancedReplay.acceptedEventIds,
      advancedBatch.events.map((item) => item.commandId),
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

    await pos.setTip(
      identity.id,
      organizationA.id,
      unitA.id,
      openId,
      `online-tip-${suffix}`,
      { tipCents: 301 },
    );
    const staleAfterOnline = await sync.synchronize(keyA, {
      ...orderedBatchBase,
      events: [
        {
          ...orderedCommand(randomUUID(), 13, 11),
          idempotencyKey: `offline-stale-after-online-${suffix}`,
          type: "pos.tab.service_charge_requested",
          payload: {
            kind: "pilot.mutation",
            action: "service-charge",
            data: { tabId: openId, basisPoints: 900 },
          },
        },
      ],
    });
    assert.equal(staleAfterOnline.rejectedEvents[0]?.code, "RESOURCE_VERSION_CONFLICT");

    const conflictResult = await sync.synchronize(keyA, {
      ...orderedBatchBase,
      events: [
        {
          ...orderedCommand(randomUUID(), 14, 12),
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

    const [concurrentTarget] = await database.db
      .insert(posDiningTables)
      .values({
        organizationId: organizationA.id,
        unitId: unitA.id,
        roomId: room.id,
        label: "Mesa concorrente",
      })
      .returning();
    assert.ok(concurrentTarget);
    const [currentTab] = await database.db.select().from(posTabs).where(eq(posTabs.id, openId));
    const [currentSourceTable] = await database.db
      .select()
      .from(posDiningTables)
      .where(eq(posDiningTables.id, transferTable.id));
    const [currentOriginalTable] = await database.db
      .select()
      .from(posDiningTables)
      .where(eq(posDiningTables.id, table.id));
    assert.ok(currentTab && currentSourceTable && currentOriginalTable);
    const concurrentTransfer = (commandId: string, target: typeof currentOriginalTable) => ({
      ...orderedCommand(commandId, 99, currentTab.resourceVersion),
      id: commandId,
      version: currentTab.resourceVersion,
      commandId,
      idempotencyKey: `concurrent-${commandId}`,
      type: "pos.tab.transfer_requested",
      resourcePreconditions: [
        resource("tab", openId, currentTab.occupancyEpoch, currentTab.resourceVersion),
        resource(
          "table",
          currentSourceTable.id,
          currentSourceTable.occupancyEpoch,
          currentSourceTable.resourceVersion,
        ),
        resource("table", target.id, target.occupancyEpoch, target.resourceVersion),
      ].sort((left, right) => `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`)),
      payload: {
        kind: "pilot.mutation",
        action: "transfer-tab",
        data: { tabId: openId, body: { tableId: target.id, reason: "Concorrência segura" } },
      },
    });
    const concurrentResults = await Promise.allSettled([
      database.withTenantContext(
        {
          source: "internal",
          organizationId: organizationA.id,
          unitId: unitA.id,
          actorIdentityId: null,
        },
        () => pilot.apply(concurrentTransfer(randomUUID(), currentOriginalTable), {
          organizationId: organizationA.id,
          unitId: unitA.id,
        }),
      ),
      database.withTenantContext(
        {
          source: "internal",
          organizationId: organizationA.id,
          unitId: unitA.id,
          actorIdentityId: null,
        },
        () => pilot.apply(concurrentTransfer(randomUUID(), concurrentTarget), {
          organizationId: organizationA.id,
          unitId: unitA.id,
        }),
      ),
    ]);
    assert.equal(concurrentResults.filter((result) => result.status === "fulfilled").length, 1);
    const concurrentRejection = concurrentResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    assert.ok(concurrentRejection?.reason instanceof Error);
    assert.equal(concurrentRejection.reason.message, "PILOT_RESOURCE_TOPOLOGY_CHANGED");

    const [beforeOnlineRace] = await database.db
      .select()
      .from(posTabs)
      .where(eq(posTabs.id, openId));
    assert.ok(beforeOnlineRace);
    let signalOnlineLocked!: () => void;
    let releaseOnline!: () => void;
    const onlineLocked = new Promise<void>((resolve) => { signalOnlineLocked = resolve; });
    const onlineRelease = new Promise<void>((resolve) => { releaseOnline = resolve; });
    const onlineRace = database.withTenantContext(
      {
        source: "internal",
        organizationId: organizationA.id,
        unitId: unitA.id,
        actorIdentityId: null,
      },
      async () => {
        const result = await pos.setTip(
          identity.id,
          organizationA.id,
          unitA.id,
          openId,
          `online-race-${suffix}`,
          { tipCents: 777 },
        );
        signalOnlineLocked();
        await onlineRelease;
        return result;
      },
    );
    await onlineLocked;
    const staleRaceId = randomUUID();
    const staleSyncRace = database.withTenantContext(
      {
        source: "internal",
        organizationId: organizationA.id,
        unitId: unitA.id,
        actorIdentityId: null,
      },
      () => pilot.apply(
        {
          ...orderedCommand(staleRaceId, 100, beforeOnlineRace.resourceVersion),
          id: staleRaceId,
          version: beforeOnlineRace.resourceVersion,
          commandId: staleRaceId,
          idempotencyKey: `sync-race-${suffix}`,
          type: "pos.tab.service_charge_requested",
          resourcePreconditions: [resource(
            "tab",
            openId,
            beforeOnlineRace.occupancyEpoch,
            beforeOnlineRace.resourceVersion,
          )],
          payload: {
            kind: "pilot.mutation",
            action: "service-charge",
            data: { tabId: openId, basisPoints: 800 },
          },
        },
        { organizationId: organizationA.id, unitId: unitA.id },
      ),
    );
    releaseOnline();
    const onlineRaceResult = await onlineRace;
    assert.equal(onlineRaceResult.tabId, openId);
    await assert.rejects(
      staleSyncRace,
      (error: unknown) =>
        error instanceof PilotConflictException &&
        error.decision.code === "RESOURCE_VERSION_CONFLICT",
    );
    const [afterOnlineRace] = await database.db.select().from(posTabs).where(eq(posTabs.id, openId));
    assert.equal(afterOnlineRace?.tipCents, 777);
    assert.equal(afterOnlineRace?.serviceChargeBasisPoints, 1_000);

    const [topologyRequestedTable, topologyChangedTable] = await database.db
      .insert(posDiningTables)
      .values([
        {
          organizationId: organizationA.id,
          unitId: unitA.id,
          roomId: room.id,
          label: "Topology requested",
        },
        {
          organizationId: organizationA.id,
          unitId: unitA.id,
          roomId: room.id,
          label: "Topology changed",
        },
      ])
      .returning();
    assert.ok(topologyRequestedTable && topologyChangedTable && afterOnlineRace?.tableId);
    const [topologyCurrentTable] = await database.db
      .select()
      .from(posDiningTables)
      .where(eq(posDiningTables.id, afterOnlineRace.tableId));
    assert.ok(topologyCurrentTable);
    const topologyVersionsBefore = new Map(
      [afterOnlineRace, topologyCurrentTable, topologyRequestedTable, topologyChangedTable].map(
        (row) => [row.id, row.resourceVersion],
      ),
    );
    let signalTopologyLock!: () => void;
    let releaseTopologyWriter!: () => void;
    const topologyLockReady = new Promise<void>((resolve) => {
      signalTopologyLock = resolve;
    });
    const topologyWriterRelease = new Promise<void>((resolve) => {
      releaseTopologyWriter = resolve;
    });
    const topologyLockKey = `pos-resource:${organizationA.id}:${unitA.id}:tab:${openId}`;
    const topologyWriter = database.client.begin(async (client) => {
      await client.unsafe("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
        topologyLockKey,
      ]);
      signalTopologyLock();
      await topologyWriterRelease;
      await client.unsafe(
        "update pos_tabs set table_id = $1 where organization_id = $2 and unit_id = $3 and id = $4",
        [topologyChangedTable.id, organizationA.id, unitA.id, openId],
      );
    });
    await topologyLockReady;
    const topologyRaceId = randomUUID();
    const topologyRace = database.withTenantContext(
      {
        source: "internal",
        organizationId: organizationA.id,
        unitId: unitA.id,
        actorIdentityId: null,
      },
      () =>
        pilot.apply(
          {
            ...orderedCommand(topologyRaceId, 101, afterOnlineRace.resourceVersion),
            id: topologyRaceId,
            version: afterOnlineRace.resourceVersion,
            commandId: topologyRaceId,
            idempotencyKey: `topology-race-${suffix}`,
            type: "pos.tab.transfer_requested",
            resourcePreconditions: [
              resource(
                "tab",
                openId,
                afterOnlineRace.occupancyEpoch,
                afterOnlineRace.resourceVersion,
              ),
              resource(
                "table",
                topologyCurrentTable.id,
                topologyCurrentTable.occupancyEpoch,
                topologyCurrentTable.resourceVersion,
              ),
              resource(
                "table",
                topologyRequestedTable.id,
                topologyRequestedTable.occupancyEpoch,
                topologyRequestedTable.resourceVersion,
              ),
            ].sort((left, right) =>
              `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`),
            ),
            payload: {
              kind: "pilot.mutation",
              action: "transfer-tab",
              data: {
                tabId: openId,
                body: { tableId: topologyRequestedTable.id, reason: "Topology race" },
              },
            },
          },
          { organizationId: organizationA.id, unitId: unitA.id },
        ),
    );
    let observedAdvisoryWait = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [waiting] = await database.client<{ waiting: number }[]>`
        select count(*)::int as waiting from pg_stat_activity
        where wait_event_type = 'Lock' and wait_event = 'advisory'
          and query like '%hashtextextended%'
      `;
      if ((waiting?.waiting ?? 0) > 0) {
        observedAdvisoryWait = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    releaseTopologyWriter();
    await topologyWriter;
    assert.equal(observedAdvisoryWait, true);
    await assert.rejects(topologyRace, /PILOT_RESOURCE_TOPOLOGY_CHANGED/);
    const [topologyTabAfter] = await database.db.select().from(posTabs).where(eq(posTabs.id, openId));
    const topologyTablesAfter = await database.db
      .select()
      .from(posDiningTables)
      .where(eq(posDiningTables.organizationId, organizationA.id));
    assert.equal(topologyTabAfter?.tableId, topologyChangedTable.id);
    assert.equal(topologyTabAfter?.resourceVersion, topologyVersionsBefore.get(openId));
    for (const tableRow of topologyTablesAfter.filter((row) => topologyVersionsBefore.has(row.id))) {
      assert.equal(tableRow.resourceVersion, topologyVersionsBefore.get(tableRow.id));
    }

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
    if (previousFingerprintVersion === undefined)
      delete process.env.COMMAND_FINGERPRINT_ACTIVE_KEY_VERSION;
    else process.env.COMMAND_FINGERPRINT_ACTIVE_KEY_VERSION = previousFingerprintVersion;
    if (previousFingerprintKeys === undefined) delete process.env.COMMAND_FINGERPRINT_KEYS;
    else process.env.COMMAND_FINGERPRINT_KEYS = previousFingerprintKeys;
    await database.onModuleDestroy();
  }
});
