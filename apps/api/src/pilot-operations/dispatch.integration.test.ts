import assert from "node:assert/strict";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  dispatchEffects,
  deviceEnrollments,
  hubCommands,
  hubHeartbeats,
  identities,
  memberships,
  organizations,
  posOrders,
  posProductionStations,
  posTabs,
  productionStationRoutes,
  roleBindings,
  units,
} from "@giromesa/db";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { DispatchCloudWorker } from "./dispatch-cloud.worker.js";
import { PilotPosService } from "./pilot-pos.service.js";

it("creates one effect per destination and keeps attempts, ack, reprint and DLQ auditable", async (context) => {
  const databaseUrl = process.env.DISPATCH_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("DISPATCH_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  try {
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "Dispatch Ltda",
        tradeName: "Dispatch",
        document: String(randomInt(10_000_000_000_000, 99_999_999_999_999)),
        billingState: "active",
      })
      .returning();
    assert.ok(organization);
    const [unit] = await database.db
      .insert(units)
      .values({ organizationId: organization.id, name: "Dispatch Unit" })
      .returning();
    const [identity] = await database.db
      .insert(identities)
      .values({ email: `dispatch-${randomUUID()}@example.test`, displayName: "Owner" })
      .returning();
    assert.ok(unit && identity);
    const syncKey = `dispatch-sync-${randomUUID()}`;
    const [hub] = await database.db
      .insert(deviceEnrollments)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        label: "Edge Hub",
        syncKeyHash: createHash("sha256").update(syncKey).digest("hex"),
      })
      .returning();
    assert.ok(hub);
    await database.db.insert(hubHeartbeats).values({
      organizationId: organization.id,
      unitId: unit.id,
      hubId: hub.id,
      version: "1.0.0",
      lastSeenAt: new Date(),
    });
    const [membership] = await database.db
      .insert(memberships)
      .values({ organizationId: organization.id, identityId: identity.id, status: "active" })
      .returning();
    assert.ok(membership);
    await database.db.insert(roleBindings).values({ membershipId: membership.id, role: "owner" });
    const [tab] = await database.db
      .insert(posTabs)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        openedByIdentityId: identity.id,
        guestCount: 1,
      })
      .returning();
    assert.ok(tab);
    const [order] = await database.db
      .insert(posOrders)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        tabId: tab.id,
        createdByIdentityId: identity.id,
        status: "sent",
        sentAt: new Date(),
      })
      .returning();
    const [station] = await database.db
      .insert(posProductionStations)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        name: "Cozinha",
        code: `k-${randomUUID().slice(0, 8)}`,
      })
      .returning();
    assert.ok(order && station);
    await database.db.insert(productionStationRoutes).values({
      organizationId: organization.id,
      unitId: unit.id,
      stationId: station.id,
      mode: "both",
      kdsTargetRef: "kds:cozinha",
      printerTargetRef: "printer:cozinha",
    });
    const service = new PilotPosService(database, new ScopeService(database));
    const [created, replay] = await Promise.all([
      service.ensureDispatchEffects(
        identity.id,
        organization.id,
        unit.id,
        order.id,
        station.id,
        "dispatch-order-sent",
      ),
      service.ensureDispatchEffects(
        identity.id,
        organization.id,
        unit.id,
        order.id,
        station.id,
        "dispatch-order-sent",
      ),
    ]);
    assert.equal(created.effects.length, 2);
    assert.equal(replay.effects.length, 2);
    const cloudWorker = new DispatchCloudWorker(database);
    const [scheduled, duplicateSchedule] = await Promise.all([
      cloudWorker.runOnce(),
      cloudWorker.runOnce(),
    ]);
    assert.equal(scheduled.scheduled + duplicateSchedule.scheduled, 2);
    const cloudCommands = await database.db
      .select()
      .from(hubCommands)
      .where(eq(hubCommands.hubId, hub.id));
    assert.equal(cloudCommands.length, 2);
    assert.deepEqual(
      cloudCommands.map((command) => command.type),
      ["dispatch.effect.execute", "dispatch.effect.execute"],
    );
    const printer = created.effects.find((effect) => effect.destination === "printer");
    assert.ok(printer);
    const reprint = await service.reprintDispatch(
      identity.id,
      organization.id,
      unit.id,
      printer.id,
      "dispatch-reprint",
    );
    assert.equal(reprint.operation, "reprint");
    const cancel = await service.cancelDispatch(
      identity.id,
      organization.id,
      unit.id,
      reprint.id,
      "dispatch-cancel",
    );
    assert.equal(cancel.operation, "cancel");
    const acked = await service.ackDispatch(
      identity.id,
      organization.id,
      unit.id,
      printer.id,
      "ack-printer-1",
    );
    assert.equal(acked.state, "acked");
    const kds = created.effects.find((effect) => effect.destination === "kds");
    assert.ok(kds);
    const failed = await service.failDispatch(
      identity.id,
      organization.id,
      unit.id,
      kds.id,
      "terminal failure",
      true,
    );
    const [dlq] = await database.db
      .select()
      .from(dispatchEffects)
      .where(eq(dispatchEffects.state, "dlq"))
      .limit(1);
    assert.ok(dlq);
    const reconciled = await service.reconcileDispatch(
      identity.id,
      organization.id,
      unit.id,
      failed.id,
      failed.resourceVersion,
      "retry",
    );
    assert.equal(reconciled.state, "pending");
  } finally {
    await database.onModuleDestroy();
  }
});
