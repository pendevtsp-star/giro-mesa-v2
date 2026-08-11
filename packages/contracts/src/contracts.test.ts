import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activateTrialSchema,
  contactRequestSchema,
  createOrganizationSchema,
  loginRequestSchema,
  onboardingSelectionSchema,
  operationalCommandSchema,
  publicOrderSchema,
  registerRequestSchema,
  registerSchema,
  trialApplicationRequestSchema,
  updateOnboardingSchema,
} from "./index.js";

describe("public contracts", () => {
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

  it("accepts N-1 onboarding progress without treating booleans as evidence", () => {
    assert.deepEqual(updateOnboardingSchema.parse({ checklist: { business: true } }), {
      checklist: { business: true },
    });
    assert.equal(updateOnboardingSchema.safeParse({}).success, false);
  });

  it("keeps structured onboarding evidence strict", () => {
    assert.equal(
      updateOnboardingSchema.safeParse({
        items: {
          training: {
            status: "verified",
            evidenceReference: "training-session-2026-08-11",
            evidence: { attendees: 4 },
          },
        },
      }).success,
      true,
    );
    assert.equal(
      updateOnboardingSchema.safeParse({
        items: { training: { status: "verified", browserVerified: true } },
      }).success,
      false,
    );
  });

  it("requires an explicit plan and unit selection before the activation contract", () => {
    const unitId = crypto.randomUUID();
    assert.deepEqual(
      onboardingSelectionSchema.parse({ planSlug: "operacao", selectedUnitId: unitId }),
      { planSlug: "operacao", selectedUnitId: unitId, reselect: false },
    );
    assert.equal(
      onboardingSelectionSchema.safeParse({
        planSlug: "operacao",
        selectedUnitId: unitId,
        browserVerified: true,
      }).success,
      false,
    );
    assert.deepEqual(activateTrialSchema.parse({}), {});
    assert.deepEqual(activateTrialSchema.parse({ planSlug: "operacao" }), {
      planSlug: "operacao",
    });
  });
});
