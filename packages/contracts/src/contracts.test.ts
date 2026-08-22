import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type BusinessHours,
  businessHoursSchema,
  contactRequestSchema,
  copyUnitSettingsSchema,
  createOrganizationSchema,
  deliveryAddressSchema,
  deliveryCourierAssignmentSchema,
  deliveryCourierCreateSchema,
  deliveryCourierPositionSchema,
  deliveryNotificationSchema,
  inviteMembershipSchema,
  loginRequestSchema,
  operationalCapabilityAliases,
  operationalCapabilitySchema,
  operationalCommandSchema,
  publicOrderSchema,
  registerRequestSchema,
  registerSchema,
  timezoneSchema,
  trialApplicationRequestSchema,
} from "./index.js";

describe("public contracts", () => {
  it("validates structured establishment hours and IANA timezones", () => {
    const weekly: BusinessHours["weekly"] = Array.from({ length: 7 }, (_, index) => ({
      weekday: index + 1,
      mode: "closed" as const,
    }));
    weekly[0] = {
      weekday: 1,
      mode: "periods",
      periods: [
        { start: "11:00", end: "15:00", endsNextDay: false },
        { start: "18:00", end: "01:00", endsNextDay: true },
      ],
    };
    assert.equal(businessHoursSchema.safeParse({ weekly, exceptions: [] }).success, true);
    assert.equal(timezoneSchema.safeParse("America/Sao_Paulo").success, true);
    assert.equal(timezoneSchema.safeParse("Mars/Olympus_Mons").success, false);
    assert.equal(
      businessHoursSchema.safeParse({
        weekly: weekly.map((day, index) => (index === 1 ? { ...day, weekday: 1 } : day)),
        exceptions: [],
      }).success,
      false,
    );
  });

  it("rejects overlapping hours, duplicate exceptions and copy targets", () => {
    const weekly: BusinessHours["weekly"] = Array.from({ length: 7 }, (_, index) => ({
      weekday: index + 1,
      mode: "closed" as const,
    }));
    weekly[0] = {
      weekday: 1,
      mode: "periods",
      periods: [{ start: "22:00", end: "02:00", endsNextDay: true }],
    };
    weekly[1] = {
      weekday: 2,
      mode: "periods",
      periods: [{ start: "01:00", end: "03:00", endsNextDay: false }],
    };
    assert.equal(businessHoursSchema.safeParse({ weekly, exceptions: [] }).success, false);
    assert.equal(
      businessHoursSchema.safeParse({
        weekly: Array.from({ length: 7 }, (_, index) => ({
          weekday: index + 1,
          mode: "closed",
        })),
        exceptions: [
          { date: "2026-12-25", mode: "closed" },
          { date: "2026-12-25", mode: "open24h" },
        ],
      }).success,
      false,
    );
    const unitId = crypto.randomUUID();
    assert.equal(
      copyUnitSettingsSchema.safeParse({ targetUnitIds: [unitId, unitId] }).success,
      false,
    );
  });

  it("normalizes identity email and rejects weak passwords", () => {
    const result = registerSchema.parse({
      email: " Owner@Example.COM ",
      password: "a-secure-passphrase",
      displayName: "Owner",
    });
    assert.equal(result.email, "owner@example.com");
    assert.equal(registerSchema.safeParse({ ...result, password: "short" }).success, false);
    assert.equal(
      registerSchema.safeParse({
        ...result,
        email: `public-orders+${crypto.randomUUID()}@system.giromesa.invalid`,
      }).success,
      false,
    );
  });

  it("keeps CNPJ and command identity strict", () => {
    assert.equal(
      createOrganizationSchema.safeParse({
        legalName: "Bar Ltda",
        tradeName: "Bar",
        document: "123",
        unitName: "Centro",
      }).success,
      false,
    );
    const alphanumeric = createOrganizationSchema.parse({
      legalName: "Bar Ltda",
      tradeName: "Bar",
      document: "12abc345000112",
      unitName: "Centro",
    });
    assert.equal(alphanumeric.document, "12ABC345000112");
    assert.equal(
      operationalCommandSchema.safeParse({
        id: crypto.randomUUID(),
        deviceId: crypto.randomUUID(),
        type: "order.created",
        version: 1,
        occurredAt: new Date().toISOString(),
        idempotencyKey: "order-key-1",
        payload: {},
      }).success,
      true,
    );
  });

  it("accepts the delivery operator role", () => {
    const invite = inviteMembershipSchema.parse({
      email: "delivery@example.com",
      role: "delivery",
      unitId: crypto.randomUUID(),
    });
    assert.equal(invite.role, "delivery");
    assert.equal(
      inviteMembershipSchema.parse({
        email: "contador@example.com",
        role: "accountant",
        unitId: null,
      }).role,
      "accountant",
    );
  });

  it("publishes canonical operational capabilities with legacy aliases", () => {
    assert.equal(
      operationalCapabilitySchema.parse("operations:payments:record"),
      "operations:payments:record",
    );
    assert.equal(operationalCapabilitySchema.safeParse("payments:write").success, false);
    assert.deepEqual(operationalCapabilityAliases["payments:write"], [
      "operations:payments:record",
    ]);
  });

  it("adapts the actual marketing forms at the API boundary", () => {
    assert.deepEqual(
      registerRequestSchema.parse({
        name: "Maria Silva",
        email: "maria@example.com",
        password: "safe-password-123",
        termsAccepted: "true",
      }),
      { displayName: "Maria Silva", email: "maria@example.com", password: "safe-password-123" },
    );
    assert.equal(
      loginRequestSchema.parse({
        email: "maria@example.com",
        password: "safe-password-123",
        trustedDevice: "on",
      }).trustedDevice,
      true,
    );
    const trial = trialApplicationRequestSchema.parse({
      name: "Maria Silva",
      email: "maria@example.com",
      phone: "11999999999",
      businessName: "Bar Maria",
      segment: "Bar",
      plan: "Operação",
      privacyAccepted: "true",
    });
    assert.equal(trial.planSlug, "operacao");
    assert.equal(trial.segment, "Bar");
    assert.equal(
      contactRequestSchema.parse({
        name: "Maria Silva",
        email: "maria@example.com",
        phone: "11999999999",
        message: "Preciso de ajuda com a implantação.",
        privacyAccepted: true,
      }).privacyAccepted,
      true,
    );
  });

  it("allows only pay-on-fulfillment and enforces fulfillment-specific address data", () => {
    const base = {
      customer: { name: "Maria Silva", phone: "+5511999999999" },
      items: [{ productId: crypto.randomUUID(), quantity: 2, modifierOptionIds: [] }],
      paymentMethod: "pay_on_fulfillment" as const,
      privacyAccepted: true as const,
      policyVersion: "2026-08-public-orders",
    };
    assert.equal(publicOrderSchema.safeParse({ ...base, fulfillment: "pickup" }).success, true);
    assert.equal(
      publicOrderSchema.safeParse({
        ...base,
        fulfillment: "pickup",
        address: {
          street: "Rua Um",
          number: "10",
          neighborhood: "Centro",
          city: "São Paulo",
          state: "SP",
          postalCode: "01001-000",
        },
      }).success,
      false,
    );
    assert.equal(publicOrderSchema.safeParse({ ...base, fulfillment: "delivery" }).success, false);
    assert.equal(
      publicOrderSchema.safeParse({
        ...base,
        fulfillment: "pickup",
        paymentMethod: "credit_card",
      }).success,
      false,
    );
  });

  it("validates normalized delivery coordinates", () => {
    const address = {
      street: "Rua Um",
      number: "10",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "sp",
      postalCode: "01001-000",
      latitude: -23.5505,
      longitude: -46.6333,
    };
    assert.equal(deliveryAddressSchema.parse(address).state, "SP");
    assert.equal(deliveryAddressSchema.safeParse({ ...address, latitude: 91 }).success, false);
    assert.equal(
      deliveryAddressSchema.safeParse({ ...address, longitude: undefined }).success,
      false,
    );
  });

  it("keeps delivery courier and notification commands strict and idempotent", () => {
    const idempotencyKey = "delivery-command-0001";
    assert.equal(
      deliveryCourierCreateSchema.safeParse({
        unitId: "f898be18-4f20-4e20-93b3-75468c80646e",
        reference: "courier-42",
        name: "Maria Entregas",
        idempotencyKey,
      }).success,
      true,
    );
    assert.equal(
      deliveryCourierAssignmentSchema.safeParse({
        courierId: "f898be18-4f20-4e20-93b3-75468c80646e",
        idempotencyKey,
        unitId: "f898be18-4f20-4e20-93b3-75468c80646e",
      }).success,
      false,
    );
    assert.equal(
      deliveryCourierPositionSchema.safeParse({
        latitude: -23.5,
        longitude: -46.6,
        idempotencyKey,
      }).success,
      true,
    );
    assert.equal(
      deliveryNotificationSchema.safeParse({
        audience: "customer",
        type: "courier_arriving",
        idempotencyKey,
      }).success,
      true,
    );
  });
});
