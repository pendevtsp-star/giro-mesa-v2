import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  apiHealthResponseSchema,
  type BusinessHours,
  billingCheckoutInputSchema,
  billingSummarySchema,
  billingUpgradeQuoteSchema,
  businessHoursSchema,
  contactRequestSchema,
  copyUnitSettingsSchema,
  createOrganizationSchema,
  createTableQrPrintBatchSchema,
  deliveryAddressSchema,
  deliveryCourierAssignmentSchema,
  deliveryCourierCreateSchema,
  deliveryCourierPositionSchema,
  deliveryNotificationSchema,
  establishmentPresentationSchema,
  inviteMembershipSchema,
  loginRequestSchema,
  operationalCapabilityAliases,
  operationalCapabilitySchema,
  operationalCommandSchema,
  operationalPushSubscriptionSchema,
  publicMenuCommandSchema,
  publicOrderSchema,
  publicTableOrderSchema,
  publicTableSessionRequestSchema,
  publicTableSessionResponseSchema,
  registerRequestSchema,
  registerSchema,
  tableQrLifecycleSchema,
  testTableQrUrlSchema,
  timezoneSchema,
  trialApplicationRequestSchema,
  updateTableQrSettingsSchema,
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
      copyUnitSettingsSchema.safeParse({ expectedRevision: 0, targetUnitIds: [unitId, unitId] })
        .success,
      false,
    );
    assert.equal(
      copyUnitSettingsSchema.safeParse({ expectedRevision: 0, targetUnitIds: [unitId] }).success,
      true,
    );
    const presentation = establishmentPresentationSchema.parse({
      displayName: "Casa",
      primaryColor: "#123456",
      accentColor: "#abcdef",
      phone: "(82) 99999-9999",
      addressDetails: {
        postalCode: "57000-000",
        street: "Rua Principal",
        number: "10",
        district: "Centro",
        city: "Maceió",
        state: "al",
      },
    });
    assert.equal(presentation.addressDetails?.postalCode, "57000000");
    assert.equal(presentation.addressDetails?.state, "AL");
    assert.equal(
      establishmentPresentationSchema.safeParse({
        displayName: "Casa",
        primaryColor: "#123456",
        accentColor: "#abcdef",
        phone: "9999-9999",
      }).success,
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

  it("keeps table QR settings, print lifecycle and pre-tab sessions strict", () => {
    const tableId = crypto.randomUUID();
    assert.equal(
      publicTableSessionRequestSchema.safeParse({ presenceCode: "123456" }).success,
      true,
    );
    assert.equal(
      publicTableSessionResponseSchema.safeParse({
        status: "awaiting_tab",
        activeTab: false,
        tableLabel: "Mesa 01",
        expiresAt: new Date().toISOString(),
      }).success,
      true,
    );
    assert.equal(
      updateTableQrSettingsSchema.safeParse({
        expectedRevision: 0,
        displayName: "Casa",
        headline: "Peça direto da mesa",
        instructions: "Aponte a câmera para o QR Code.",
        logoUrl: "https://cdn.example.test/logo.png",
        primaryColor: "#123456",
        wifiNotice: null,
        serviceChargeNotice: null,
        template: "classic",
        presenceProtection: "daily_code",
      }).success,
      true,
    );
    assert.equal(
      updateTableQrSettingsSchema.safeParse({
        expectedRevision: 0,
        displayName: "Casa",
        headline: "Peça direto da mesa",
        instructions: "Aponte a câmera para o QR Code.",
        logoUrl: "data:image/png;base64,AA==",
        primaryColor: "#123456",
        wifiNotice: null,
        serviceChargeNotice: null,
        template: "classic",
        presenceProtection: "session_only",
      }).success,
      false,
    );
    assert.deepEqual(
      createTableQrPrintBatchSchema.parse({
        format: "table_tent",
        output: "print",
        tableIds: [tableId],
      }),
      { format: "table_tent", output: "print", includeWifi: false, tableIds: [tableId] },
    );
    assert.equal(
      createTableQrPrintBatchSchema.safeParse({
        format: "a4_6",
        output: "pdf",
        includeWifi: true,
        tableIds: [tableId, tableId],
      }).success,
      false,
    );
    assert.equal(testTableQrUrlSchema.safeParse({ url: "javascript:alert(1)" }).success, false);
    assert.equal(
      tableQrLifecycleSchema.safeParse({ settings: {}, tables: [], batches: [], rotations: [] })
        .success,
      false,
    );
  });

  it("requires release identity and declared API capabilities", () => {
    assert.equal(
      apiHealthResponseSchema.safeParse({
        status: "ok",
        version: "2.0.0",
        buildSha: "local",
        schemaVersion: 60,
        capabilities: ["table_qr_lifecycle_v1"],
        database: "up",
        integrations: {},
      }).success,
      true,
    );
    assert.equal(
      apiHealthResponseSchema.safeParse({ status: "ok", version: "2.0.0" }).success,
      false,
    );
  });

  it("accepts only HTTPS Web Push subscriptions with browser key sizes", () => {
    const subscription = {
      endpoint: "https://fcm.googleapis.com/fcm/send/example",
      expirationTime: null,
      keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
    };
    assert.equal(operationalPushSubscriptionSchema.safeParse(subscription).success, true);
    assert.equal(
      operationalPushSubscriptionSchema.safeParse({
        ...subscription,
        endpoint: "http://localhost/internal",
      }).success,
      false,
    );
    assert.equal(
      operationalPushSubscriptionSchema.safeParse({
        ...subscription,
        keys: { ...subscription.keys, auth: "too-short" },
      }).success,
      false,
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

  it("keeps billing summaries and hosted checkout intents explicit", () => {
    const planId = crypto.randomUUID();
    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000);
    assert.equal(
      billingSummarySchema.safeParse({
        state: "active",
        access: "full",
        onboarding: null,
        current: {
          source: "subscription",
          plan: {
            id: planId,
            slug: "crescimento",
            name: "Crescimento",
            includedUnits: 2,
            entitlements: ["reports"],
          },
          cycle: "monthly",
          priceCents: 19_900,
          periodStartsAt: now.toISOString(),
          periodEndsAt: periodEnd.toISOString(),
          renewsAutomatically: true,
          paymentMethod: "pix",
        },
        charges: [],
        plans: [
          {
            id: planId,
            slug: "crescimento",
            name: "Crescimento",
            monthlyPriceCents: 19_900,
            annualPriceCents: 199_000,
            includedUnits: 2,
            entitlements: ["reports"],
            current: true,
            upgradeEligible: false,
          },
        ],
        actions: {
          onlinePaymentsEnabled: true,
          canSubscribe: false,
          canRegularize: false,
          canUpgrade: true,
          unavailableReason: null,
        },
      }).success,
      true,
    );

    assert.deepEqual(
      billingCheckoutInputSchema.parse({
        intent: "subscribe",
        planSlug: "crescimento",
        cycle: "annual",
        promotionCode: " giro-20 ",
      }),
      {
        intent: "subscribe",
        planSlug: "crescimento",
        cycle: "annual",
        promotionCode: "GIRO-20",
      },
    );
    assert.equal(
      billingCheckoutInputSchema.safeParse({
        intent: "regularize",
        chargeId: crypto.randomUUID(),
        planSlug: "crescimento",
      }).success,
      false,
    );
    assert.equal(
      billingUpgradeQuoteSchema.safeParse({
        id: crypto.randomUUID(),
        sourcePlanSlug: "operacao",
        targetPlanSlug: "crescimento",
        cycle: "monthly",
        periodEndsAt: periodEnd.toISOString(),
        amountCents: 5_000,
        remainingRatio: 0.5,
        expiresAt: new Date(now.getTime() + 15 * 60 * 1_000).toISOString(),
        status: "quoted",
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
      attribution: {
        campaignSlug: "lancamento",
        experimentSlug: "hero-agosto",
        variantKey: "b",
        visitorId: "visitor-12345678",
        landingVersion: 2,
        utmSource: "instagram",
        termsVersion: "2026-08",
        privacyVersion: "2026-08",
      },
    });
    assert.equal(trial.planSlug, "operacao");
    assert.equal(trial.segment, "Bar");
    assert.equal(trial.attribution?.utmSource, "instagram");
    assert.equal(
      trialApplicationRequestSchema.safeParse({
        name: "Maria Silva",
        email: "maria@example.com",
        phone: "11999999999",
        businessName: "Bar Maria",
        segment: "Bar",
        plan: "Operação",
        privacyAccepted: true,
      }).success,
      false,
    );
    assert.equal(
      contactRequestSchema.parse({
        name: "Maria Silva",
        email: "maria@example.com",
        phone: "11999999999",
        message: "Preciso de ajuda com a implantação.",
        privacyAccepted: true,
        attribution: {
          landingVersion: 2,
          termsVersion: "2026-08",
          privacyVersion: "2026-08",
          utmCampaign: "agosto",
        },
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

  it("keeps QR table commands and order drafts strict", () => {
    const item = { productId: crypto.randomUUID(), quantity: 2, modifierOptionIds: [] };
    assert.equal(
      publicMenuCommandSchema.safeParse({ type: "call_waiter", payload: {} }).success,
      true,
    );
    assert.equal(
      publicMenuCommandSchema.safeParse({ type: "request_check", payload: {} }).success,
      true,
    );
    assert.equal(
      publicMenuCommandSchema.safeParse({ type: "place_order", payload: {} }).success,
      false,
    );
    assert.equal(
      publicMenuCommandSchema.safeParse({ type: "call_waiter", payload: { tableId: "forged" } })
        .success,
      false,
    );
    assert.equal(publicTableOrderSchema.safeParse({ items: [item] }).success, true);
    assert.equal(
      publicTableOrderSchema.safeParse({ items: [item], tabId: crypto.randomUUID() }).success,
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
