import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  identities,
  memberships,
  organizations,
  posCatalogCategories,
  posDiningRooms,
  posDiningTables,
  posProductAvailability,
  posProductionStations,
  posProductPrices,
  posProductStations,
  posProducts,
  roleBindings,
  units,
} from "@giromesa/db";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { PilotPosService } from "./pilot-pos.service.js";

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
    await pos.transitionKds(
      identity.id,
      organizationA.id,
      unitA.id,
      ticketId,
      "kds-preparing-0001",
      { state: "preparing" },
    );
    await pos.transitionKds(identity.id, organizationA.id, unitA.id, ticketId, "kds-ready-0001", {
      state: "ready",
    });
    await pos.transitionKds(identity.id, organizationA.id, unitA.id, ticketId, "kds-done-0001", {
      state: "done",
    });
    await assert.rejects(() =>
      pos.transitionKds(identity.id, organizationA.id, unitA.id, ticketId, "kds-reverse-0001", {
        state: "ready",
      }),
    );
  } finally {
    await database.onModuleDestroy();
  }
});
