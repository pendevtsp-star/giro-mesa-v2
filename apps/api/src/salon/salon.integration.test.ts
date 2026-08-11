import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  deviceEnrollments,
  identities,
  memberships,
  organizations,
  posDiningRooms,
  posDiningTables,
  roleBindings,
  salonExceptions,
  serviceAreas,
  serviceShifts,
  units,
} from "@giromesa/db";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { SalonService } from "./salon.service.js";

function hasCode(code: string) {
  return (error: unknown) => {
    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    return typeof response === "object" && response !== null && (response as { code?: string }).code === code;
  };
}

it("publishes immutable layouts and maintains scoped assignments, presence and exceptions", async (context) => {
  const databaseUrl = process.env.SALON_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("SALON_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  try {
    const [organizationA, organizationB] = await database.db
      .insert(organizations)
      .values([
        { legalName: "Salon A Ltda", tradeName: "Salon A", document: String(randomInt(10_000_000_000_000, 99_999_999_999_999)) },
        { legalName: "Salon B Ltda", tradeName: "Salon B", document: String(randomInt(10_000_000_000_000, 99_999_999_999_999)) },
      ])
      .returning();
    assert.ok(organizationA && organizationB);
    const [unitA, unitB] = await database.db
      .insert(units)
      .values([
        { organizationId: organizationA.id, name: "Salon A" },
        { organizationId: organizationB.id, name: "Salon B" },
      ])
      .returning();
    const [owner, waiter] = await database.db
      .insert(identities)
      .values([
        { email: `salon-owner-${randomUUID()}@example.test`, displayName: "Owner" },
        { email: `salon-waiter-${randomUUID()}@example.test`, displayName: "Waiter" },
      ])
      .returning();
    assert.ok(unitA && unitB && owner && waiter);
    const [ownerMembership, waiterMembership] = await database.db
      .insert(memberships)
      .values([
        { organizationId: organizationA.id, identityId: owner.id, status: "active" },
        { organizationId: organizationA.id, identityId: waiter.id, status: "active" },
      ])
      .returning();
    assert.ok(ownerMembership && waiterMembership);
    await database.db.insert(roleBindings).values([
      { membershipId: ownerMembership.id, role: "owner" },
      { membershipId: waiterMembership.id, unitId: unitA.id, role: "waiter" },
    ]);
    const [room] = await database.db
      .insert(posDiningRooms)
      .values({ organizationId: organizationA.id, unitId: unitA.id, name: "Salão" })
      .returning();
    assert.ok(room);
    const [table] = await database.db
      .insert(posDiningTables)
      .values({ organizationId: organizationA.id, unitId: unitA.id, roomId: room.id, label: "01" })
      .returning();
    const [area] = await database.db
      .insert(serviceAreas)
      .values({ organizationId: organizationA.id, unitId: unitA.id, roomId: room.id, name: "Varanda", code: "varanda" })
      .returning();
    assert.ok(table && area);
    const salon = new SalonService(database, new ScopeService(database));
    const layout = await salon.createLayout(owner.id, organizationA.id, unitA.id, room.id);
    const edited = await salon.replaceNodes(owner.id, organizationA.id, unitA.id, layout.id, 0, [
      { tableId: table.id, areaId: area.id, x: 500, y: 800, width: 1_800, height: 1_400, rotation: 0, zIndex: 1 },
    ]);
    const published = await salon.publishLayout(owner.id, organizationA.id, unitA.id, layout.id, edited.resourceVersion);
    assert.equal(published.state, "published");
    await assert.rejects(
      () => salon.replaceNodes(owner.id, organizationA.id, unitA.id, layout.id, published.resourceVersion, []),
      hasCode("LAYOUT_IMMUTABLE"),
    );
    await assert.rejects(
      () => salon.operationalMap(owner.id, organizationB.id, unitB.id, room.id),
      hasCode("UNIT_ACCESS_DENIED"),
    );

    const [shift] = await database.db
      .insert(serviceShifts)
      .values({ organizationId: organizationA.id, unitId: unitA.id, state: "open", startsAt: new Date(), openedByIdentityId: owner.id })
      .returning();
    assert.ok(shift);
    await salon.assignArea(owner.id, organizationA.id, unitA.id, shift.id, area.id, {
      primaryIdentityId: waiter.id,
      supportIdentityId: null,
      fallbackRole: "manager",
    });
    const [device] = await database.db
      .insert(deviceEnrollments)
      .values({ organizationId: organizationA.id, unitId: unitA.id, label: "Waiter tablet" })
      .returning();
    assert.ok(device);
    const lease = await salon.renewPresence(waiter.id, organizationA.id, unitA.id, device.id, null);
    const acknowledged = await salon.ackPresence(waiter.id, organizationA.id, unitA.id, device.id, lease.leaseEpoch, lease.resourceVersion);
    assert.ok(acknowledged.acknowledgedAt);
    const waiterMap = await salon.operationalMap(waiter.id, organizationA.id, unitA.id, room.id);
    assert.deepEqual(waiterMap.allowedAreaIds, [area.id]);

    const [exception] = await database.db
      .insert(salonExceptions)
      .values({ organizationId: organizationA.id, unitId: unitA.id, tableId: table.id, code: "PAYMENT_UNCERTAIN", severity: "high" })
      .returning();
    assert.ok(exception);
    const acknowledgedException = await salon.acknowledgeException(owner.id, organizationA.id, unitA.id, exception.id);
    assert.equal(acknowledgedException.state, "acknowledged");
  } finally {
    await database.onModuleDestroy();
  }
});
