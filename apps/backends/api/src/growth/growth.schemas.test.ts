import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  campaignCancelSchema,
  couponUpdateSchema,
  crmAutomationRuleSchema,
  customerListQuerySchema,
  customerMergeSchema,
  customerUpdateSchema,
  deliveryOrderQuerySchema,
  deliveryOrderSchema,
  deliveryZoneSchema,
  deliveryZoneUpdateSchema,
  evolutionConfigurationSchema,
  evolutionWebhookSchema,
  publicCouponValidationSchema,
  publicReservationSchema,
  publicWaitlistSchema,
  reservationListQuerySchema,
  waitlistListQuerySchema,
  webhookEndpointSchema,
  whatsappInboxQuerySchema,
  whatsappMessageSchema,
} from "./growth.schemas.js";

describe("growth API boundaries", () => {
  it("bounds CRM search and requires explicit customer mutations", () => {
    assert.deepEqual(customerListQuerySchema.parse({ q: "  Maria  ", limit: "20" }), {
      q: "Maria",
      limit: 20,
      offset: 0,
    });
    assert.equal(customerListQuerySchema.safeParse({ limit: 101 }).success, false);
    assert.equal(customerUpdateSchema.safeParse({}).success, false);
    assert.deepEqual(customerUpdateSchema.parse({ tags: ["vip", "aniversário"] }).tags, [
      "vip",
      "aniversário",
    ]);
    assert.equal(
      customerMergeSchema.safeParse({
        sourceCustomerId: "f898be18-4f20-4e20-93b3-75468c80646e",
        reason: "duplicidade",
      }).success,
      true,
    );
    assert.equal(couponUpdateSchema.safeParse({}).success, false);
    assert.equal(campaignCancelSchema.safeParse({ reason: "x" }).success, false);
  });

  it("bounds reception lists and validates reservation periods", () => {
    assert.deepEqual(reservationListQuerySchema.parse({}), {
      scope: "active",
      limit: 100,
      offset: 0,
    });
    assert.equal(
      reservationListQuerySchema.safeParse({
        from: "2026-08-18T00:00:00.000Z",
        to: "2026-08-17T00:00:00.000Z",
      }).success,
      false,
    );
    assert.equal(waitlistListQuerySchema.safeParse({ limit: 201 }).success, false);
  });

  it("keeps delivery update and listing inputs strict and bounded", () => {
    assert.deepEqual(deliveryZoneUpdateSchema.parse({ name: "  Centro  ", active: false }), {
      name: "Centro",
      active: false,
    });
    assert.equal(deliveryZoneUpdateSchema.safeParse({}).success, false);
    assert.equal(
      deliveryZoneUpdateSchema.safeParse({
        active: true,
        unitId: "f898be18-4f20-4e20-93b3-75468c80646e",
      }).success,
      false,
    );

    const query = deliveryOrderQuerySchema.parse({
      status: "ready",
      updatedSince: "2026-08-16T12:00:00-03:00",
      limit: "25",
      query: "  Maria  ",
      scheduled: "true",
    });
    assert.equal(query.limit, 25);
    assert.equal(query.query, "Maria");
    assert.equal(query.scheduled, true);
    assert.ok(query.updatedSince);
    assert.equal(query.updatedSince.toISOString(), "2026-08-16T15:00:00.000Z");
    assert.equal(deliveryOrderQuerySchema.safeParse({ limit: "201" }).success, false);
    assert.equal(deliveryOrderQuerySchema.parse({ sla: "overdue" }).sla, "overdue");
    assert.equal(deliveryOrderQuerySchema.safeParse({ sla: "late" }).success, false);
    assert.equal(deliveryOrderQuerySchema.safeParse({ unknown: "value" }).success, false);
  });

  it("validates delivery SLA and reuses the shared address contract", () => {
    const zone = deliveryZoneSchema.parse({
      unitId: "f898be18-4f20-4e20-93b3-75468c80646e",
      name: "Centro",
      feeCents: 800,
      geometry: { type: "Polygon", coordinates: [] },
    });
    assert.equal(zone.estimatedDeliveryMinutes, 45);
    assert.equal(
      deliveryZoneUpdateSchema.safeParse({ estimatedDeliveryMinutes: 241 }).success,
      false,
    );

    const input = {
      unitId: "f898be18-4f20-4e20-93b3-75468c80646e",
      zoneId: "f898be18-4f20-4e20-93b3-75468c80646e",
      orderRef: "f898be18-4f20-4e20-93b3-75468c80646e",
      fulfillment: "delivery",
      address: {
        street: "Rua Central",
        number: "10",
        neighborhood: "Centro",
        city: "SÃ£o Paulo",
        state: "sp",
        postalCode: "01001-000",
      },
      promisedAt: "2026-08-16T22:00:00-03:00",
      idempotencyKey: "delivery-address-0001",
    };
    const order = deliveryOrderSchema.parse(input);
    assert.equal(order.address?.state, "SP");
    assert.equal(order.promisedAt?.toISOString(), "2026-08-17T01:00:00.000Z");
    assert.equal(
      deliveryOrderSchema.safeParse({
        ...input,
        address: { ...input.address, neighborhood: undefined },
      }).success,
      false,
    );
  });

  it("accepts public HTTPS webhook targets and blocks local targets", () => {
    assert.equal(
      webhookEndpointSchema.safeParse({
        url: "https://hooks.example.com/giro",
        eventTypes: ["order.closed"],
      }).success,
      true,
    );
    assert.equal(
      webhookEndpointSchema.safeParse({
        url: "https://127.0.0.1/hook",
        eventTypes: ["order.closed"],
      }).success,
      false,
    );
    assert.equal(
      webhookEndpointSchema.safeParse({
        url: "http://hooks.example.com/giro",
        eventTypes: ["order.closed"],
      }).success,
      false,
    );
  });

  it("requires explicit privacy acceptance on public reservation and waitlist submissions", () => {
    const reservation = {
      guestName: "Maria Silva",
      guestPhone: "+5511999999999",
      partySize: 4,
      scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      policyVersion: "2026-08-public",
    };
    assert.equal(
      publicReservationSchema.safeParse({ ...reservation, privacyAccepted: true }).success,
      true,
    );
    assert.equal(publicReservationSchema.safeParse(reservation).success, false);
    assert.equal(
      publicWaitlistSchema.safeParse({
        guestName: "Maria Silva",
        guestPhone: "+5511999999999",
        partySize: 4,
        privacyAccepted: false,
        policyVersion: "2026-08-public",
      }).success,
      false,
    );
  });

  it("rejects tenant and operational identifiers on public inputs", () => {
    assert.equal(
      publicWaitlistSchema.safeParse({
        guestName: "Maria Silva",
        guestPhone: "+5511999999999",
        partySize: 4,
        privacyAccepted: true,
        policyVersion: "2026-08-public",
        unitId: "f898be18-4f20-4e20-93b3-75468c80646e",
        quotedWaitMinutes: 10,
      }).success,
      false,
    );
    assert.equal(
      publicCouponValidationSchema.safeParse({
        code: "MESA10",
        orderTotalCents: 10_000,
        customerId: "f898be18-4f20-4e20-93b3-75468c80646e",
      }).success,
      false,
    );
  });

  it("bounds Evolution Go, inbox sends and CRM automations", () => {
    const unitId = "f898be18-4f20-4e20-93b3-75468c80646e";
    assert.equal(evolutionConfigurationSchema.safeParse({ unitId, enabled: true }).success, true);
    assert.equal(
      evolutionConfigurationSchema.safeParse({
        unitId,
        enabled: true,
        quietHoursStart: "25:00",
      }).success,
      false,
    );
    assert.equal(
      whatsappMessageSchema.safeParse({ unitId, body: "Olá", idempotencyKey: "send-1" }).success,
      false,
    );
    assert.equal(
      whatsappMessageSchema.safeParse({
        unitId,
        phone: "5511999999999",
        idempotencyKey: "send-media-1",
        media: {
          fileName: "arquivo.pdf",
          mimeType: "application/pdf",
          base64: "JVBERi0=",
        },
      }).success,
      true,
    );
    assert.equal(
      whatsappInboxQuerySchema.safeParse({
        unitId,
        cursorAt: "2026-08-25T12:00:00.000Z",
      }).success,
      false,
    );
    assert.equal(
      crmAutomationRuleSchema.safeParse({
        unitId,
        trigger: "inactive",
        enabled: true,
        delayMinutes: 0,
        messageTemplate: "Olá, {nome}",
      }).success,
      false,
    );
    assert.equal(
      evolutionWebhookSchema.safeParse({
        event: "message",
        instanceToken: "x".repeat(64),
        data: {},
      }).success,
      true,
    );
  });
});
