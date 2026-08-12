import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  identities,
  memberships,
  organizations,
  posDiningRooms,
  posDiningTables,
  roleBindings,
  units,
} from "@giromesa/db";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { PilotPosService } from "./pilot-pos.service.js";

it("serializes a table occupancy with epoch, CAS and idempotent events", async (context) => {
  const databaseUrl = process.env.OCCUPANCY_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("OCCUPANCY_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  try {
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "Occupancy Ltda",
        tradeName: "Occupancy",
        document: String(randomInt(10_000_000_000_000, 99_999_999_999_999)),
        billingState: "active",
      })
      .returning();
    assert.ok(organization);
    const [unit] = await database.db
      .insert(units)
      .values({ organizationId: organization.id, name: "Occupancy Unit" })
      .returning();
    const [identity] = await database.db
      .insert(identities)
      .values({ email: `occupancy-${randomUUID()}@example.test`, displayName: "Owner" })
      .returning();
    assert.ok(unit && identity);
    const [membership] = await database.db
      .insert(memberships)
      .values({ organizationId: organization.id, identityId: identity.id, status: "active" })
      .returning();
    assert.ok(membership);
    await database.db.insert(roleBindings).values({ membershipId: membership.id, role: "owner" });
    const [room] = await database.db
      .insert(posDiningRooms)
      .values({ organizationId: organization.id, unitId: unit.id, name: "Salão" })
      .returning();
    assert.ok(room);
    const [table] = await database.db
      .insert(posDiningTables)
      .values({ organizationId: organization.id, unitId: unit.id, roomId: room.id, label: "01" })
      .returning();
    assert.ok(table);
    const pos = new PilotPosService(database, new ScopeService(database));
    const opened = await pos.openTab(identity.id, organization.id, unit.id, "open-occupancy", {
      tableId: table.id,
      guestCount: 2,
    });
    const occupancy = opened.occupancy as {
      id: string;
      occupancyEpoch: string;
      resourceVersion: number;
    };
    assert.ok(occupancy);

    const command = {
      type: "begin_payment" as const,
      occupancyEpoch: occupancy.occupancyEpoch,
      expectedVersion: occupancy.resourceVersion,
    };
    const raced = await Promise.allSettled([
      pos.transitionOccupancy(
        identity.id,
        organization.id,
        unit.id,
        occupancy.id,
        "pay-a",
        command,
      ),
      pos.transitionOccupancy(
        identity.id,
        organization.id,
        unit.id,
        occupancy.id,
        "pay-b",
        command,
      ),
    ]);
    assert.equal(raced.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(raced.filter((result) => result.status === "rejected").length, 1);

    const closed = await pos.transitionOccupancy(
      identity.id,
      organization.id,
      unit.id,
      occupancy.id,
      "close-a",
      { type: "close", occupancyEpoch: occupancy.occupancyEpoch, expectedVersion: 1 },
    );
    assert.equal((closed.occupancy as { state: string }).state, "closed");
    const replay = await pos.transitionOccupancy(
      identity.id,
      organization.id,
      unit.id,
      occupancy.id,
      "close-a",
      { type: "close", occupancyEpoch: occupancy.occupancyEpoch, expectedVersion: 1 },
    );
    assert.equal(replay.idempotentReplay, true);
  } finally {
    await database.onModuleDestroy();
  }
});
