import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  billingCheckouts,
  commercialCatalogVersions,
  commercialPlans,
  commercialPromotions,
  identities,
  memberships,
  onboardingRecords,
  organizations,
  roleBindings,
} from "@giromesa/db";
import { eq, inArray } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { BillingService } from "./billing.service.js";

test("allows only the owner of the requested organization to read billing", async (context) => {
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("PILOT_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  const organizationIds: string[] = [];
  const identityIds: string[] = [];
  try {
    const suffix = randomUUID();
    const documentPrefix = suffix.replaceAll("-", "").slice(0, 13);
    const [organization, foreignOrganization] = await database.db
      .insert(organizations)
      .values([
        {
          legalName: "Billing Tenant Ltda",
          tradeName: "Billing Tenant",
          document: `${documentPrefix}1`,
          billingState: "onboarding",
        },
        {
          legalName: "Foreign Billing Tenant Ltda",
          tradeName: "Foreign Billing Tenant",
          document: `${documentPrefix}2`,
          billingState: "active",
        },
      ])
      .returning();
    assert.ok(organization && foreignOrganization);
    organizationIds.push(organization.id, foreignOrganization.id);
    const [owner, manager, foreignOwner] = await database.db
      .insert(identities)
      .values([
        { email: `billing-owner+${suffix}@example.test`, displayName: "Billing Owner" },
        { email: `billing-manager+${suffix}@example.test`, displayName: "Billing Manager" },
        { email: `billing-foreign+${suffix}@example.test`, displayName: "Foreign Owner" },
      ])
      .returning();
    assert.ok(owner && manager && foreignOwner);
    identityIds.push(owner.id, manager.id, foreignOwner.id);
    const [ownerMembership, managerMembership, foreignMembership] = await database.db
      .insert(memberships)
      .values([
        { identityId: owner.id, organizationId: organization.id, status: "active" },
        { identityId: manager.id, organizationId: organization.id, status: "active" },
        {
          identityId: foreignOwner.id,
          organizationId: foreignOrganization.id,
          status: "active",
        },
      ])
      .returning();
    assert.ok(ownerMembership && managerMembership && foreignMembership);
    await database.db.insert(roleBindings).values([
      { membershipId: ownerMembership.id, role: "owner" },
      { membershipId: managerMembership.id, role: "manager" },
      { membershipId: foreignMembership.id, role: "owner" },
    ]);
    await database.db.insert(onboardingRecords).values({
      organizationId: organization.id,
      checklist: { business: true, unit: true },
    });

    const billing = new BillingService(database, new ScopeService(database));
    const summary = await billing.summary(owner.id, organization.id);
    assert.equal(summary.state, "onboarding");
    assert.deepEqual(summary.onboarding?.missingItems, [
      "catalog",
      "team",
      "production",
      "cashier",
      "fiscalChoice",
      "training",
      "rehearsal",
    ]);
    await assert.rejects(() => billing.summary(manager.id, organization.id));
    await assert.rejects(() => billing.summary(foreignOwner.id, organization.id));
    await assert.rejects(() => billing.summary(owner.id, foreignOrganization.id));
  } finally {
    if (organizationIds.length > 0) {
      await database.db.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    for (const identityId of identityIds) {
      await database.db.delete(identities).where(eq(identities.id, identityId));
    }
    await database.client.end();
  }
});

test("persists the promoted checkout price selected from the published catalog", async (context) => {
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("PILOT_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  const originalFetch = globalThis.fetch;
  const previousEnvironment = Object.fromEntries(
    ["ASAAS_API_KEY", "ASAAS_WEBHOOK_SECRET", "ASAAS_API_URL", "OPS_APP_URL"].map((key) => [
      key,
      process.env[key],
    ]),
  );
  let organizationId: string | undefined;
  let identityId: string | undefined;
  let catalogId: string | undefined;
  let promotionId: string | undefined;
  try {
    const suffix = randomUUID();
    const [catalog] = await database.db
      .insert(commercialCatalogVersions)
      .values({
        version: Number.parseInt(suffix.replaceAll("-", "").slice(0, 7), 16),
        status: "published",
      })
      .returning({ id: commercialCatalogVersions.id });
    assert.ok(catalog);
    catalogId = catalog.id;
    const [plan] = await database.db
      .insert(commercialPlans)
      .values({
        catalogVersionId: catalog.id,
        slug: "operacao",
        name: "Operação",
        monthlyPriceCents: 19_900,
        annualPriceCents: 199_000,
        includedUnits: 1,
      })
      .returning({
        id: commercialPlans.id,
        slug: commercialPlans.slug,
        monthlyPriceCents: commercialPlans.monthlyPriceCents,
      });
    assert.ok(plan);
    const promotionCode = `TEST${suffix.replaceAll("-", "").slice(0, 12)}`.toUpperCase();
    const [promotion] = await database.db
      .insert(commercialPromotions)
      .values({
        catalogVersionId: catalog.id,
        name: "Cupom de integração",
        type: "fixed",
        value: 1_234,
        planSlugs: [plan.slug],
        cycles: ["monthly"],
        startsAt: new Date(Date.now() - 60_000),
        code: promotionCode,
      })
      .returning({ id: commercialPromotions.id });
    assert.ok(promotion);
    promotionId = promotion.id;

    const documentPrefix = suffix.replaceAll("-", "").slice(0, 13);
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "Promoted Billing Tenant Ltda",
        tradeName: "Promoted Billing Tenant",
        document: `${documentPrefix}1`,
        billingState: "trial_active",
      })
      .returning({ id: organizations.id });
    assert.ok(organization);
    organizationId = organization.id;
    const [owner] = await database.db
      .insert(identities)
      .values({
        email: `promoted-billing+${suffix}@example.test`,
        displayName: "Promoted Billing Owner",
      })
      .returning({ id: identities.id });
    assert.ok(owner);
    identityId = owner.id;
    const [membership] = await database.db
      .insert(memberships)
      .values({ identityId: owner.id, organizationId: organization.id, status: "active" })
      .returning({ id: memberships.id });
    assert.ok(membership);
    await database.db.insert(roleBindings).values({ membershipId: membership.id, role: "owner" });

    process.env.ASAAS_API_KEY = "integration-api-key";
    process.env.ASAAS_WEBHOOK_SECRET = "integration-webhook-secret";
    process.env.ASAAS_API_URL = "http://asaas.integration.test/v3";
    process.env.OPS_APP_URL = "http://ops.integration.test";
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ id: `provider-${suffix}`, link: "https://checkout.example.test/session" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const response = await new BillingService(database, new ScopeService(database)).createCheckout(
      owner.id,
      organization.id,
      `checkout-${suffix}`,
      { intent: "subscribe", planSlug: plan.slug, cycle: "monthly", promotionCode },
    );
    assert.equal(response.amountCents, plan.monthlyPriceCents - 1_234);
    const [persisted] = await database.db
      .select({
        amountCents: billingCheckouts.amountCents,
        promotionId: billingCheckouts.promotionId,
        promotionDiscountCents: billingCheckouts.promotionDiscountCents,
        promotionFingerprint: billingCheckouts.promotionFingerprint,
      })
      .from(billingCheckouts)
      .where(eq(billingCheckouts.id, response.id))
      .limit(1);
    assert.deepEqual(
      {
        amountCents: persisted?.amountCents,
        promotionId: persisted?.promotionId,
        promotionDiscountCents: persisted?.promotionDiscountCents,
        hasFingerprint: Boolean(persisted?.promotionFingerprint),
      },
      {
        amountCents: plan.monthlyPriceCents - 1_234,
        promotionId: promotion.id,
        promotionDiscountCents: 1_234,
        hasFingerprint: true,
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (organizationId)
      await database.db.delete(organizations).where(eq(organizations.id, organizationId));
    if (identityId) await database.db.delete(identities).where(eq(identities.id, identityId));
    if (promotionId)
      await database.db
        .delete(commercialPromotions)
        .where(eq(commercialPromotions.id, promotionId));
    if (catalogId)
      await database.db
        .delete(commercialCatalogVersions)
        .where(eq(commercialCatalogVersions.id, catalogId));
    await database.client.end();
  }
});
