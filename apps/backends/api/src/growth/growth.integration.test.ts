import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  auditEvents,
  deliveryOrders,
  identities,
  memberships,
  organizations,
  outboxEvents,
  posTabs,
  publicMenus,
  reservations,
  roleBindings,
  units,
  waitlistEntries,
} from "@giromesa/db";
import { and, eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { GrowthService } from "./growth.service.js";

function hasCode(expected: string) {
  return (error: unknown) => {
    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    return (
      typeof response === "object" &&
      response !== null &&
      (response as { code?: string }).code === expected
    );
  };
}

function document() {
  return String(randomInt(10_000_000_000_000, 99_999_999_999_999));
}

it("persists an idempotent tenant-isolated CRM, reservation and delivery flow", async (context) => {
  const databaseUrl = process.env.GROWTH_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("GROWTH_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  try {
    const scope = new ScopeService(database);
    const growth = new GrowthService(database, scope);
    const [organizationA, organizationB] = await database.db
      .insert(organizations)
      .values([
        { legalName: "Growth A Ltda", tradeName: "Growth A", document: document() },
        { legalName: "Growth B Ltda", tradeName: "Growth B", document: document() },
      ])
      .returning();
    assert.ok(organizationA && organizationB);
    const [unitA, unitB] = await database.db
      .insert(units)
      .values([
        { organizationId: organizationA.id, name: "Growth Unit A" },
        { organizationId: organizationB.id, name: "Growth Unit B" },
      ])
      .returning();
    assert.ok(unitA && unitB);
    const [identityA, identityB, deliveryIdentity] = await database.db
      .insert(identities)
      .values([
        { email: `growth-a-${randomUUID()}@example.test`, displayName: "Owner A" },
        { email: `growth-b-${randomUUID()}@example.test`, displayName: "Owner B" },
        { email: `growth-delivery-${randomUUID()}@example.test`, displayName: "Delivery A" },
      ])
      .returning();
    assert.ok(identityA && identityB && deliveryIdentity);
    const [membershipA, membershipB, deliveryMembership] = await database.db
      .insert(memberships)
      .values([
        { identityId: identityA.id, organizationId: organizationA.id, status: "active" },
        { identityId: identityB.id, organizationId: organizationB.id, status: "active" },
        {
          identityId: deliveryIdentity.id,
          organizationId: organizationA.id,
          status: "active",
        },
      ])
      .returning();
    assert.ok(membershipA && membershipB && deliveryMembership);
    await database.db.insert(roleBindings).values([
      { membershipId: membershipA.id, role: "owner" },
      { membershipId: membershipB.id, role: "owner" },
      { membershipId: deliveryMembership.id, unitId: unitA.id, role: "delivery" },
    ]);

    await assert.rejects(
      () => growth.listCustomers(identityA.id, organizationB.id),
      hasCode("INSUFFICIENT_ROLE"),
    );
    await assert.rejects(
      () =>
        growth.createCustomer(identityA.id, organizationA.id, {
          defaultUnitId: unitB.id,
          name: "Cross tenant customer",
          tags: [],
        }),
      hasCode("UNIT_NOT_FOUND"),
    );

    const customer = await growth.createCustomer(identityA.id, organizationA.id, {
      defaultUnitId: unitA.id,
      name: "Maria Integration",
      email: "maria.integration@example.test",
      phone: "+5511999999999",
      tags: [],
    });
    await growth.recordConsent(identityA.id, organizationA.id, customer.id, {
      decision: "granted",
      purpose: "marketing",
      channel: "all",
      source: "integration-test",
      legalBasis: "consent",
      policyVersion: "2026-08",
    });
    const customers = await growth.listCustomers(identityA.id, organizationA.id);
    assert.equal(customers.length, 1);
    assert.equal(customers[0]?.marketingOptIn, true);

    const publicMenuSlug = `growth-public-${randomUUID()}`;
    await database.db.insert(publicMenus).values({
      organizationId: organizationA.id,
      unitId: unitA.id,
      slug: publicMenuSlug,
      items: [],
      active: true,
      publishedAt: new Date(),
    });
    const publicReservationKey = `public-reservation-${randomUUID()}`;
    const publicReservationInput = {
      guestName: "Ana Pública",
      guestPhone: "+5511988887777",
      partySize: 3,
      scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      notes: "Mesa acessível",
      privacyAccepted: true as const,
      policyVersion: "2026-08-public",
    };
    assert.deepEqual(
      await growth.createPublicReservation(
        publicMenuSlug,
        publicReservationKey,
        publicReservationInput,
      ),
      { accepted: true },
    );
    assert.deepEqual(
      await growth.createPublicReservation(
        publicMenuSlug,
        publicReservationKey,
        publicReservationInput,
      ),
      { accepted: true },
    );
    const persistedPublicReservations = await database.db
      .select({ id: reservations.id })
      .from(reservations)
      .where(
        and(
          eq(reservations.organizationId, organizationA.id),
          eq(reservations.idempotencyKey, publicReservationKey),
        ),
      );
    assert.equal(persistedPublicReservations.length, 1);

    const publicWaitlistKey = `public-waitlist-${randomUUID()}`;
    assert.deepEqual(
      await growth.createPublicWaitlistEntry(publicMenuSlug, publicWaitlistKey, {
        guestName: "Ana Pública",
        guestPhone: "+5511988887777",
        partySize: 3,
        privacyAccepted: true,
        policyVersion: "2026-08-public",
      }),
      { accepted: true },
    );
    const persistedPublicWaitlist = await database.db
      .select({ id: waitlistEntries.id })
      .from(waitlistEntries)
      .where(
        and(
          eq(waitlistEntries.organizationId, organizationA.id),
          eq(waitlistEntries.idempotencyKey, publicWaitlistKey),
        ),
      );
    assert.equal(persistedPublicWaitlist.length, 1);

    await growth.createCoupon(identityA.id, organizationA.id, {
      unitId: unitA.id,
      code: "PUBLIC10",
      type: "percentage",
      value: 1_000,
      minimumOrderCents: 5_000,
      maximumDiscountCents: null,
      validUntil: null,
      channels: ["qr"],
      unitIds: [],
      perCustomerLimit: 1,
      active: true,
    });
    assert.deepEqual(
      await growth.validatePublicCoupon(publicMenuSlug, {
        code: "PUBLIC10",
        orderTotalCents: 10_000,
        channel: "qr",
      }),
      { valid: true, discountCents: 1_000 },
    );
    assert.deepEqual(
      await growth.validatePublicCoupon(publicMenuSlug, {
        code: "UNKNOWN",
        orderTotalCents: 10_000,
        channel: "qr",
      }),
      { valid: false },
    );

    const reservationInput = {
      unitId: unitA.id,
      customerId: customer.id,
      guestName: customer.name,
      guestPhone: customer.phone,
      partySize: 4,
      scheduledAt: new Date("2026-08-10T22:00:00.000Z"),
      durationMinutes: 120,
      notes: "Window table",
      idempotencyKey: "reservation-0001",
    };
    const reservation = await growth.createReservation(
      identityA.id,
      organizationA.id,
      reservationInput,
    );
    const replayedReservation = await growth.createReservation(
      identityA.id,
      organizationA.id,
      reservationInput,
    );
    assert.equal(replayedReservation.duplicate, true);
    assert.equal(replayedReservation.reservation.id, reservation.reservation.id);
    await assert.rejects(
      () =>
        growth.createReservation(identityA.id, organizationA.id, {
          ...reservationInput,
          partySize: 5,
        }),
      hasCode("IDEMPOTENCY_CONFLICT"),
    );
    const confirmed = await growth.transitionReservation(
      identityA.id,
      organizationA.id,
      reservation.reservation.id,
      { status: "confirmed" },
    );
    assert.equal(confirmed.status, "confirmed");

    const zone = await growth.createDeliveryZone(identityA.id, organizationA.id, {
      unitId: unitA.id,
      name: "Central",
      feeCents: 800,
      minimumOrderCents: 4_000,
      estimatedDeliveryMinutes: 60,
      geometry: { type: "Polygon", coordinates: [] },
      active: true,
    });
    await assert.rejects(
      () =>
        growth.updateDeliveryZone(deliveryIdentity.id, organizationA.id, zone.id, {
          active: false,
        }),
      hasCode("INSUFFICIENT_ROLE"),
    );
    await assert.rejects(
      () => growth.updateDeliveryZone(identityB.id, organizationB.id, zone.id, { active: false }),
      hasCode("DELIVERY_ZONE_NOT_FOUND"),
    );
    const disabledZone = await growth.updateDeliveryZone(identityA.id, organizationA.id, zone.id, {
      name: "Centro",
      feeCents: 900,
      minimumOrderCents: 4_500,
      estimatedDeliveryMinutes: 60,
      geometry: { type: "Polygon", coordinates: [[[-46.7, -23.6]]] },
      active: false,
    });
    assert.equal(disabledZone.active, false);
    assert.equal(disabledZone.name, "Centro");
    const [tab] = await database.db
      .insert(posTabs)
      .values({
        organizationId: organizationA.id,
        unitId: unitA.id,
        openedByIdentityId: identityA.id,
        label: "Delivery integration",
        subtotalCents: 5_000,
        totalCents: 5_000,
      })
      .returning();
    assert.ok(tab);
    const deliveryInput = {
      unitId: unitA.id,
      customerId: customer.id,
      zoneId: zone.id,
      orderRef: tab.id,
      fulfillment: "delivery" as const,
      address: {
        street: "Rua Integration",
        number: "10",
        neighborhood: "Centro",
        city: "Sao Paulo",
        state: "SP",
        postalCode: "01001-000",
      },
      idempotencyKey: "delivery-order-0001",
    };
    await assert.rejects(
      () => growth.createDeliveryOrder(identityA.id, organizationA.id, deliveryInput),
      hasCode("DELIVERY_ZONE_INVALID"),
    );
    const activeZone = await growth.updateDeliveryZone(identityA.id, organizationA.id, zone.id, {
      active: true,
    });
    assert.equal(activeZone.active, true);
    const deliveryCreatedAt = Date.now();
    const delivery = await growth.createDeliveryOrder(
      identityA.id,
      organizationA.id,
      deliveryInput,
    );
    const replayedDelivery = await growth.createDeliveryOrder(
      identityA.id,
      organizationA.id,
      deliveryInput,
    );
    assert.equal(replayedDelivery.duplicate, true);
    assert.equal(replayedDelivery.order.id, delivery.order.id);
    assert.equal(delivery.order.subtotalCents, 5_000);
    assert.equal(delivery.order.deliveryFeeCents, 900);
    assert.equal(delivery.order.totalCents, 5_900);
    assert.ok(delivery.order.promisedAt);
    assert.ok(delivery.order.promisedAt.getTime() >= deliveryCreatedAt + 59 * 60_000);
    assert.ok(delivery.order.promisedAt.getTime() <= Date.now() + 61 * 60_000);
    for (const status of ["placed", "confirmed", "preparing", "ready"] as const) {
      const updated = await growth.transitionDelivery(
        identityA.id,
        organizationA.id,
        delivery.order.id,
        { status },
      );
      assert.equal(updated.status, status);
    }
    const dispatch = await growth.dispatchDelivery(
      identityA.id,
      organizationA.id,
      delivery.order.id,
      { courierReference: "courier-42", idempotencyKey: "delivery-dispatch-0001" },
    );
    const replayedDispatch = await growth.dispatchDelivery(
      identityA.id,
      organizationA.id,
      delivery.order.id,
      { courierReference: "courier-42", idempotencyKey: "delivery-dispatch-0001" },
    );
    assert.equal(replayedDispatch.duplicate, true);
    assert.equal(replayedDispatch.dispatch.id, dispatch.dispatch.id);
    const [scheduledTab] = await database.db
      .insert(posTabs)
      .values({
        organizationId: organizationA.id,
        unitId: unitA.id,
        openedByIdentityId: identityA.id,
        label: "Scheduled pickup integration",
        subtotalCents: 2_000,
        totalCents: 2_000,
      })
      .returning();
    assert.ok(scheduledTab);
    const scheduledFor = new Date(Date.now() + 60 * 60 * 1000);
    const scheduledPickup = await growth.createDeliveryOrder(identityA.id, organizationA.id, {
      unitId: unitA.id,
      orderRef: scheduledTab.id,
      fulfillment: "pickup",
      scheduledFor,
      idempotencyKey: "scheduled-pickup-0001",
    });
    assert.equal(scheduledPickup.order.promisedAt?.toISOString(), scheduledFor.toISOString());
    const publicProtocol = `BUSCA-${organizationA.id.slice(0, 8)}`;
    await database.db
      .update(deliveryOrders)
      .set({
        publicProtocol,
        customerName: "Maria Busca",
        customerPhone: "+5511988880000",
      })
      .where(eq(deliveryOrders.id, scheduledPickup.order.id));
    const dispatched = await growth.listDeliveryOrders(
      deliveryIdentity.id,
      organizationA.id,
      unitA.id,
      { status: "dispatched", limit: 10 },
    );
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0]?.zoneName, "Centro");
    assert.equal(dispatched[0]?.courierReference, "courier-42");
    assert.ok(dispatched[0]?.promisedAt);
    const onTime = await growth.listDeliveryOrders(
      deliveryIdentity.id,
      organizationA.id,
      unitA.id,
      { sla: "on_time", limit: 10 },
    );
    assert.equal(
      onTime.some((order) => order.id === delivery.order.id),
      true,
    );
    await database.db
      .update(deliveryOrders)
      .set({ promisedAt: new Date(Date.now() - 60_000) })
      .where(eq(deliveryOrders.id, delivery.order.id));
    const overdue = await growth.listDeliveryOrders(
      deliveryIdentity.id,
      organizationA.id,
      unitA.id,
      { sla: "overdue", limit: 10 },
    );
    assert.equal(
      overdue.some((order) => order.id === delivery.order.id),
      true,
    );
    const scheduledSearch = await growth.listDeliveryOrders(
      deliveryIdentity.id,
      organizationA.id,
      unitA.id,
      { query: publicProtocol.toLowerCase(), scheduled: true, limit: 1 },
    );
    assert.equal(scheduledSearch.length, 1);
    assert.equal(scheduledSearch[0]?.id, scheduledPickup.order.id);
    assert.equal(
      (
        await growth.listDeliveryOrders(deliveryIdentity.id, organizationA.id, unitA.id, {
          scheduled: false,
          limit: 10,
        })
      ).some((order) => order.id === delivery.order.id),
      true,
    );
    assert.equal(
      (
        await growth.listDeliveryOrders(identityA.id, organizationA.id, unitA.id, {
          updatedSince: new Date(Date.now() + 60_000),
          limit: 10,
        })
      ).length,
      0,
    );
    await assert.rejects(
      () => growth.listDeliveryOrders(identityA.id, organizationA.id, unitB.id, { limit: 10 }),
      hasCode("UNIT_NOT_FOUND"),
    );
    const zoneAudit = await database.db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, organizationA.id),
          eq(auditEvents.entityId, zone.id),
          eq(auditEvents.action, "growth.delivery_zone.updated"),
        ),
      );
    const zoneOutbox = await database.db
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.aggregateId, zone.id),
          eq(outboxEvents.topic, "growth.delivery_zone_changed"),
        ),
      );
    assert.equal(zoneAudit.length, 2);
    assert.equal(zoneOutbox.length, 2);
    const completed = await growth.transitionDelivery(
      identityA.id,
      organizationA.id,
      delivery.order.id,
      { status: "completed" },
    );
    assert.equal(completed.status, "completed");
  } finally {
    await database.onModuleDestroy();
  }
});
