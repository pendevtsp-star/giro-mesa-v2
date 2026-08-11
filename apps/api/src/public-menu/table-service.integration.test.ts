import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { it } from "node:test";
import { areaAssignments, deviceEnrollments, identities, memberships, organizations, posDiningRooms, posDiningTables, publicMenus, roleBindings, serviceAreas, serviceShifts, staffPresenceLeases, tableLayoutNodes, tableLayoutVersions, units } from "@giromesa/db";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { PilotPosService } from "../pilot-operations/pilot-pos.service.js";
import { TableServiceService } from "./table-service.service.js";
import { TableSessionCodec, TableSessionService } from "./table-session.js";

it("routes idempotent calls and exposes only the current occupancy partial", async (context) => {
  const databaseUrl = process.env.TABLE_SERVICE_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("TABLE_SERVICE_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  try {
    const [organization] = await database.db.insert(organizations).values({ legalName: "Calls Ltda", tradeName: "Calls", document: String(randomInt(10_000_000_000_000, 99_999_999_999_999)), billingState: "active" }).returning();
    assert.ok(organization);
    const [unit] = await database.db.insert(units).values({ organizationId: organization.id, name: "Calls Unit" }).returning();
    const [identity] = await database.db.insert(identities).values({ email: `calls-${randomUUID()}@example.test`, displayName: "Owner" }).returning();
    assert.ok(unit && identity);
    const [membership] = await database.db.insert(memberships).values({ organizationId: organization.id, identityId: identity.id, status: "active" }).returning();
    assert.ok(membership);
    await database.db.insert(roleBindings).values({ membershipId: membership.id, role: "owner" });
    const [room] = await database.db.insert(posDiningRooms).values({ organizationId: organization.id, unitId: unit.id, name: "Salão" }).returning();
    assert.ok(room);
    const [table] = await database.db.insert(posDiningTables).values({ organizationId: organization.id, unitId: unit.id, roomId: room.id, label: "01" }).returning();
    const [menu] = await database.db.insert(publicMenus).values({ organizationId: organization.id, unitId: unit.id, slug: `calls-${randomUUID()}`, active: true, publishedAt: new Date() }).returning();
    assert.ok(table && menu);
    const opened = await new PilotPosService(database, new ScopeService(database)).openTab(identity.id, organization.id, unit.id, "calls-open-session", { tableId: table.id, guestCount: 2 });
    assert.equal(
      (opened.tab as { occupancyEpoch: string }).occupancyEpoch,
      (opened.occupancy as { occupancyEpoch: string }).occupancyEpoch,
    );
    const codec = new TableSessionCodec("table-service-integration-key-32-bytes-minimum");
    const sessions = new TableSessionService(database, codec);
    const issued = await sessions.issue(menu.slug, codec.issueTableQr({ organizationId: organization.id, unitId: unit.id, menuId: menu.id, tableId: table.id }), "calls-source");
    const service = new TableServiceService(database, sessions, new ScopeService(database));

    const call = await service.request(menu.slug, issued.token, "a".repeat(32), "calls-waiter-request", "waiter");
    assert.equal(call.call.state, "received");
    assert.equal(call.call.routeSource, "unassigned");
    const replay = await service.request(menu.slug, issued.token, "b".repeat(32), "calls-waiter-request", "waiter");
    assert.equal(replay.idempotentReplay, true);

    const [waiter] = await database.db.insert(identities).values({ email: `waiter-${randomUUID()}@example.test`, displayName: "Waiter" }).returning();
    assert.ok(waiter);
    const [waiterMembership] = await database.db.insert(memberships).values({ organizationId: organization.id, identityId: waiter.id, status: "active" }).returning();
    assert.ok(waiterMembership);
    await database.db.insert(roleBindings).values({ membershipId: waiterMembership.id, unitId: unit.id, role: "waiter" });
    const [area] = await database.db.insert(serviceAreas).values({ organizationId: organization.id, unitId: unit.id, roomId: room.id, name: "Principal", code: "principal" }).returning();
    const [layout] = await database.db.insert(tableLayoutVersions).values({ organizationId: organization.id, unitId: unit.id, roomId: room.id, version: 1, state: "draft", createdByIdentityId: identity.id }).returning();
    assert.ok(area && layout);
    await database.db.insert(tableLayoutNodes).values({ organizationId: organization.id, unitId: unit.id, layoutVersionId: layout.id, tableId: table.id, areaId: area.id, x: 10, y: 10, width: 100, height: 100 });
    await database.db.update(tableLayoutVersions).set({ state: "published", resourceVersion: 1, publishedAt: new Date() }).where(eq(tableLayoutVersions.id, layout.id));
    const [shift] = await database.db.insert(serviceShifts).values({ organizationId: organization.id, unitId: unit.id, state: "open", startsAt: new Date(), openedByIdentityId: identity.id }).returning();
    const [device] = await database.db.insert(deviceEnrollments).values({ organizationId: organization.id, unitId: unit.id, label: "Waiter POS" }).returning();
    assert.ok(shift && device);
    await database.db.insert(areaAssignments).values({ organizationId: organization.id, unitId: unit.id, shiftId: shift.id, areaId: area.id, primaryIdentityId: waiter.id });
    await database.db.insert(staffPresenceLeases).values({ organizationId: organization.id, unitId: unit.id, identityId: waiter.id, deviceId: device.id, acknowledgedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) });
    const routed = await service.request(menu.slug, issued.token, "c".repeat(32), "calls-bill-request", "bill");
    assert.equal(routed.call.state, "routed");
    assert.equal(routed.call.routeSource, "primary");
    assert.equal(routed.call.routedIdentityId, waiter.id);

    const partial = await service.partial(menu.slug, issued.token);
    assert.equal(partial.occupancyId, (opened.occupancy as { id: string }).id);
    assert.equal(partial.tab.id, (opened.tab as { id: string }).id);
    const attended = await service.attend(identity.id, organization.id, unit.id, call.call.id, 0);
    assert.equal(attended.state, "attended");
  } finally {
    await database.onModuleDestroy();
  }
});
