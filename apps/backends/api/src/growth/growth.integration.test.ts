import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  auditEvents,
  deliveryOrderStatusHistory,
  deliveryOrders,
  identities,
  managementCashRegisters,
  managementCashShifts,
  memberships,
  organizations,
  outboxEvents,
  posKdsTickets,
  posOrders,
  posProductionStations,
  posTabs,
  publicMenus,
  reservations,
  roleBindings,
  units,
  waitlistEntries,
  whatsappConversations,
} from "@giromesa/db";
import { and, eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { PilotPosService } from "../pilot-operations/pilot-pos.service.js";
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
    const pos = new PilotPosService(database, scope);
    const [organizationA, organizationB] = await database.db
      .insert(organizations)
      .values([
        { legalName: "Growth A Ltda", tradeName: "Growth A", document: document() },
        { legalName: "Growth B Ltda", tradeName: "Growth B", document: document() },
      ])
      .returning();
    assert.ok(organizationA && organizationB);
    const [unitA, unitASecondary, unitB] = await database.db
      .insert(units)
      .values([
        { organizationId: organizationA.id, name: "Growth Unit A" },
        { organizationId: organizationA.id, name: "Growth Unit A Secondary" },
        { organizationId: organizationB.id, name: "Growth Unit B" },
      ])
      .returning();
    assert.ok(unitA && unitASecondary && unitB);
    const [identityA, identityB, deliveryIdentity, waiterIdentity, financeIdentity] =
      await database.db
        .insert(identities)
        .values([
          { email: `growth-a-${randomUUID()}@example.test`, displayName: "Owner A" },
          { email: `growth-b-${randomUUID()}@example.test`, displayName: "Owner B" },
          { email: `growth-delivery-${randomUUID()}@example.test`, displayName: "Delivery A" },
          { email: `growth-waiter-${randomUUID()}@example.test`, displayName: "Waiter A" },
          { email: `growth-finance-${randomUUID()}@example.test`, displayName: "Finance A" },
        ])
        .returning();
    assert.ok(identityA && identityB && deliveryIdentity && waiterIdentity && financeIdentity);
    const [membershipA, membershipB, deliveryMembership, waiterMembership, financeMembership] =
      await database.db
        .insert(memberships)
        .values([
          { identityId: identityA.id, organizationId: organizationA.id, status: "active" },
          { identityId: identityB.id, organizationId: organizationB.id, status: "active" },
          {
            identityId: deliveryIdentity.id,
            organizationId: organizationA.id,
            status: "active",
          },
          {
            identityId: waiterIdentity.id,
            organizationId: organizationA.id,
            status: "active",
          },
          {
            identityId: financeIdentity.id,
            organizationId: organizationA.id,
            status: "active",
          },
        ])
        .returning();
    assert.ok(
      membershipA && membershipB && deliveryMembership && waiterMembership && financeMembership,
    );
    await database.db.insert(roleBindings).values([
      { membershipId: membershipA.id, role: "owner" },
      { membershipId: membershipB.id, role: "owner" },
      { membershipId: deliveryMembership.id, unitId: unitA.id, role: "delivery" },
      { membershipId: waiterMembership.id, unitId: unitA.id, role: "waiter" },
      { membershipId: financeMembership.id, unitId: unitA.id, role: "finance" },
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

    const inboundAt = new Date("2026-09-09T15:00:00.000Z");
    await database.db.insert(whatsappConversations).values([
      {
        organizationId: organizationA.id,
        unitId: unitA.id,
        customerId: customer.id,
        phone: "5511999999999",
        status: "open",
        lastMessageAt: inboundAt,
        lastInboundAt: inboundAt,
        lastOutboundAt: new Date("2026-09-09T14:00:00.000Z"),
      },
      {
        organizationId: organizationA.id,
        unitId: unitA.id,
        phone: "5511988888888",
        status: "pending",
        lastMessageAt: inboundAt,
        lastInboundAt: new Date("2026-09-09T13:00:00.000Z"),
        lastOutboundAt: inboundAt,
      },
      {
        organizationId: organizationB.id,
        unitId: unitB.id,
        phone: "5511977777777",
        status: "open",
        lastMessageAt: inboundAt,
        lastInboundAt: inboundAt,
      },
    ]);
    const needsReply = await growth.listWhatsAppInbox(identityA.id, organizationA.id, {
      unitId: unitA.id,
      limit: 50,
      assignedTo: "any",
      needsReply: true,
    });
    assert.deepEqual(
      needsReply.items.map((conversation) => conversation.phone),
      ["5511999999999"],
    );

    const [cashRegister] = await database.db
      .insert(managementCashRegisters)
      .values({
        organizationId: organizationA.id,
        unitId: unitA.id,
        name: "Caixa integração",
        active: true,
      })
      .returning();
    assert.ok(cashRegister);
    await database.db.insert(managementCashShifts).values({
      organizationId: organizationA.id,
      unitId: unitA.id,
      cashRegisterId: cashRegister.id,
      operatorIdentityId: identityA.id,
      currentResponsibleIdentityId: identityA.id,
      openingCents: 10_000,
      openIdempotencyKey: `growth-multiunit-${randomUUID()}`,
    });
    const ownerSummary = await growth.consolidatedSummary(identityA.id, organizationA.id);
    assert.equal(ownerSummary.units.length, 2);
    assert.equal(ownerSummary.units.find((unit) => unit.id === unitA.id)?.cash.status, "open");
    assert.equal(
      ownerSummary.units.find((unit) => unit.id === unitASecondary.id)?.cash.status,
      "unavailable",
    );
    const scopedSummary = await growth.consolidatedSummary(financeIdentity.id, organizationA.id);
    assert.deepEqual(
      scopedSummary.units.map((unit) => unit.id),
      [unitA.id],
    );

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
      geometry: { type: "circle", center: [-46.65, -23.56], radiusKm: 5 },
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
        fulfillmentType: "delivery",
        customerName: "Maria da comanda",
        customerPhone: "11988880000",
        subtotalCents: 5_000,
        totalCents: 5_000,
      })
      .returning();
    assert.ok(tab);
    const [deliveryPosOrder] = await database.db
      .insert(posOrders)
      .values({
        organizationId: organizationA.id,
        unitId: unitA.id,
        tabId: tab.id,
        createdByIdentityId: identityA.id,
        status: "sent",
        sentAt: new Date(),
      })
      .returning();
    assert.ok(deliveryPosOrder);
    const missingProjection = await pos.deliveryProjectionStatus(
      identityA.id,
      organizationA.id,
      unitA.id,
    );
    assert.equal(missingProjection.totalMissing, 1);
    assert.equal(missingProjection.missing[0]?.tabId, tab.id);
    assert.equal(missingProjection.missing[0]?.orderId, deliveryPosOrder.id);
    await assert.rejects(
      () => pos.deliveryProjectionStatus(waiterIdentity.id, organizationA.id, unitA.id),
      hasCode("POS_ROLE_DENIED"),
    );
    await assert.rejects(
      () => pos.deliveryProjectionStatus(identityB.id, organizationA.id, unitA.id),
      hasCode("UNIT_ACCESS_DENIED"),
    );
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
        latitude: -23.56,
        longitude: -46.65,
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
    await assert.rejects(
      () =>
        growth.createDeliveryOrder(identityA.id, organizationA.id, {
          ...deliveryInput,
          fulfillment: "pickup",
          idempotencyKey: "samekey1",
        }),
      hasCode("DELIVERY_FULFILLMENT_MISMATCH"),
    );
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
    assert.equal(delivery.order.customerName, "Maria da comanda");
    assert.equal(delivery.order.customerPhone, "+5511988880000");
    assert.equal(delivery.order.addressValidationStatus, "covered");
    assert.ok(delivery.order.promisedAt);
    assert.ok(delivery.order.promisedAt.getTime() >= deliveryCreatedAt + 59 * 60_000);
    assert.ok(delivery.order.promisedAt.getTime() <= Date.now() + 61 * 60_000);
    assert.equal(
      (await pos.deliveryProjectionStatus(identityA.id, organizationA.id, unitA.id)).totalMissing,
      0,
    );
    const [deliveryStation] = await database.db
      .insert(posProductionStations)
      .values({
        organizationId: organizationA.id,
        unitId: unitA.id,
        name: "Expedição delivery",
        code: `delivery-${randomUUID().slice(0, 8)}`,
        deliveryMode: "kds_only",
      })
      .returning();
    assert.ok(deliveryStation);
    await database.db.insert(posKdsTickets).values({
      organizationId: organizationA.id,
      unitId: unitA.id,
      orderId: deliveryPosOrder.id,
      stationId: deliveryStation.id,
      status: "ready",
      readyAt: new Date(),
    });
    await database.db
      .update(posOrders)
      .set({ status: "ready", updatedAt: new Date() })
      .where(eq(posOrders.id, deliveryPosOrder.id));
    assert.equal(
      (await pos.deliveryProjectionStatus(identityA.id, organizationA.id, unitA.id)).totalMissing,
      0,
    );
    for (const status of ["placed", "confirmed", "preparing", "ready"] as const) {
      const updated = await growth.transitionDelivery(
        identityA.id,
        organizationA.id,
        delivery.order.id,
        { status },
      );
      assert.equal(updated.status, status);
    }
    await assert.rejects(
      () =>
        growth.transitionDelivery(identityA.id, organizationA.id, delivery.order.id, {
          status: "dispatched",
        } as never),
      hasCode("DELIVERY_DISPATCH_ENDPOINT_REQUIRED"),
    );
    await assert.rejects(
      () =>
        growth.dispatchDelivery(waiterIdentity.id, organizationA.id, delivery.order.id, {
          courierReference: "courier-42",
          idempotencyKey: "delivery-dispatch-waiter-0001",
        }),
      hasCode("GROWTH_CAPABILITY_DENIED"),
    );
    await assert.rejects(
      () =>
        growth.listDeliveryOrders(waiterIdentity.id, organizationA.id, unitA.id, {
          limit: 10,
        }),
      hasCode("GROWTH_CAPABILITY_DENIED"),
    );
    const concurrentDispatches = await Promise.all(
      [0, 1].map(() =>
        growth.dispatchDelivery(identityA.id, organizationA.id, delivery.order.id, {
          courierReference: "courier-42",
          idempotencyKey: "delivery-dispatch-0001",
        }),
      ),
    );
    const dispatch = concurrentDispatches.find((result) => !result.duplicate);
    const replayedDispatch = concurrentDispatches.find((result) => result.duplicate);
    assert.ok(dispatch && replayedDispatch);
    assert.equal(replayedDispatch.duplicate, true);
    assert.equal(replayedDispatch.dispatch.id, dispatch.dispatch.id);
    assert.equal(replayedDispatch.order.status, "dispatched");
    const [uncheckedTab] = await database.db
      .insert(posTabs)
      .values({
        organizationId: organizationA.id,
        unitId: unitA.id,
        openedByIdentityId: identityA.id,
        label: "Delivery sem coordenadas",
        fulfillmentType: "delivery",
        subtotalCents: 5_000,
        totalCents: 5_000,
      })
      .returning();
    assert.ok(uncheckedTab);
    const uncheckedDelivery = await growth.createDeliveryOrder(identityA.id, organizationA.id, {
      ...deliveryInput,
      orderRef: uncheckedTab.id,
      address: {
        street: "Rua sem coordenadas",
        number: "20",
        neighborhood: "Centro",
        city: "Sao Paulo",
        state: "SP",
        postalCode: "01001-000",
      },
      idempotencyKey: "delivery-unchecked-0001",
    });
    assert.equal(uncheckedDelivery.order.addressValidationStatus, "unchecked");
    for (const status of ["placed", "confirmed", "preparing", "ready"] as const) {
      await growth.transitionDelivery(identityA.id, organizationA.id, uncheckedDelivery.order.id, {
        status,
      });
    }
    await assert.rejects(
      () =>
        growth.dispatchDelivery(identityA.id, organizationA.id, uncheckedDelivery.order.id, {
          courierReference: "courier-unchecked",
          idempotencyKey: "delivery-dispatch-unchecked-0001",
        }),
      hasCode("DELIVERY_COVERAGE_OVERRIDE_REQUIRED"),
    );
    const overrideReason = "Cobertura confirmada por telefone com o cliente.";
    const overrideDispatch = await growth.dispatchDelivery(
      identityA.id,
      organizationA.id,
      uncheckedDelivery.order.id,
      {
        courierReference: "courier-unchecked",
        coverageOverrideReason: overrideReason,
        idempotencyKey: "delivery-dispatch-unchecked-0002",
      },
    );
    const [[overrideHistory], [overrideAudit], [overrideOutbox]] = await Promise.all([
      database.db
        .select({ metadata: deliveryOrderStatusHistory.metadata })
        .from(deliveryOrderStatusHistory)
        .where(
          and(
            eq(deliveryOrderStatusHistory.deliveryOrderId, uncheckedDelivery.order.id),
            eq(deliveryOrderStatusHistory.toStatus, "dispatched"),
          ),
        )
        .limit(1),
      database.db
        .select({ metadata: auditEvents.metadata })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.entityId, overrideDispatch.dispatch.id),
            eq(auditEvents.action, "growth.delivery.dispatched"),
          ),
        )
        .limit(1),
      database.db
        .select({ payload: outboxEvents.payload })
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.aggregateId, uncheckedDelivery.order.id),
            eq(outboxEvents.topic, "growth.delivery_dispatched"),
          ),
        )
        .limit(1),
    ]);
    for (const metadata of [
      overrideHistory?.metadata,
      overrideAudit?.metadata,
      overrideOutbox?.payload,
    ]) {
      assert.equal(
        (metadata as { addressValidationStatus?: string } | null)?.addressValidationStatus,
        "unchecked",
      );
      assert.equal(
        (metadata as { coverageOverrideReason?: string } | null)?.coverageOverrideReason,
        overrideReason,
      );
    }
    const [scheduledTab] = await database.db
      .insert(posTabs)
      .values({
        organizationId: organizationA.id,
        unitId: unitA.id,
        openedByIdentityId: identityA.id,
        label: "Scheduled pickup integration",
        fulfillmentType: "pickup",
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
    assert.equal(dispatched.length, 2);
    const canonicalDispatch = dispatched.find((order) => order.id === delivery.order.id);
    assert.equal(canonicalDispatch?.zoneName, "Centro");
    assert.equal(canonicalDispatch?.courierReference, "courier-42");
    assert.ok(canonicalDispatch?.promisedAt);
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
    await assert.rejects(
      () =>
        growth.transitionDelivery(identityA.id, organizationA.id, delivery.order.id, {
          status: "delivery_failed",
        }),
      hasCode("DELIVERY_TRANSITION_REASON_REQUIRED"),
    );
    const failureReason = "Cliente ausente após duas tentativas de contato.";
    const failed = await growth.transitionDelivery(
      identityA.id,
      organizationA.id,
      delivery.order.id,
      { status: "delivery_failed", reason: failureReason },
    );
    assert.equal(failed.status, "delivery_failed");
    const retry = await growth.transitionDelivery(
      identityA.id,
      organizationA.id,
      delivery.order.id,
      { status: "ready", reason: "Nova tentativa autorizada pelo atendimento." },
    );
    assert.equal(retry.status, "ready");
    await growth.dispatchDelivery(identityA.id, organizationA.id, delivery.order.id, {
      courierReference: "courier-42",
      idempotencyKey: "delivery-dispatch-retry-0002",
    });
    const redispatched = await growth.listDeliveryOrders(
      deliveryIdentity.id,
      organizationA.id,
      unitA.id,
      { status: "dispatched", limit: 10 },
    );
    assert.equal(redispatched.filter((order) => order.id === delivery.order.id).length, 1);
    const [failureHistory] = await database.db
      .select({ metadata: deliveryOrderStatusHistory.metadata })
      .from(deliveryOrderStatusHistory)
      .where(
        and(
          eq(deliveryOrderStatusHistory.deliveryOrderId, delivery.order.id),
          eq(deliveryOrderStatusHistory.toStatus, "delivery_failed"),
        ),
      )
      .limit(1);
    assert.equal((failureHistory?.metadata as { reason?: string }).reason, failureReason);
    const completed = await growth.transitionDelivery(
      identityA.id,
      organizationA.id,
      delivery.order.id,
      { status: "completed" },
    );
    assert.equal(completed.status, "completed");
    assert.equal(completed.paymentStatus, "awaiting_payment");
  } finally {
    await database.onModuleDestroy();
  }
});
