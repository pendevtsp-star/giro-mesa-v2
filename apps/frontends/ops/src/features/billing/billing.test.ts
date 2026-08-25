import { describe, expect, it } from "vitest";
import { sessionForScope } from "../../app/access";
import {
  outstandingCharge,
  parseBillingCheckout,
  parseBillingSummary,
  parseUpgradeQuote,
} from "./billing";

const summaryPayload = {
  state: "active",
  access: "full",
  onboarding: null,
  current: {
    source: "subscription",
    plan: {
      id: "plan-1",
      slug: "operacao",
      name: "Operação",
      includedUnits: 1,
      entitlements: ["salon", "cashier"],
    },
    cycle: "monthly",
    priceCents: 14900,
    periodStartsAt: "2026-08-01T00:00:00.000Z",
    periodEndsAt: "2026-09-01T00:00:00.000Z",
    renewsAutomatically: true,
    paymentMethod: "credit_card",
  },
  charges: [
    {
      id: "charge-1",
      amountCents: 14900,
      status: "pending",
      dueAt: "2026-09-01T00:00:00.000Z",
      paidAt: null,
      paymentUrl: null,
    },
  ],
  plans: [
    {
      id: "plan-1",
      slug: "operacao",
      name: "Operação",
      monthlyPriceCents: 14900,
      annualPriceCents: 149000,
      includedUnits: 1,
      entitlements: ["salon", "cashier"],
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
};

describe("assinatura e cobrança", () => {
  it("interpreta o resumo persistido sem duplicar preços no cliente", () => {
    const summary = parseBillingSummary(summaryPayload);

    expect(summary.current?.plan.slug).toBe("operacao");
    expect(summary.plans[0]?.monthlyPriceCents).toBe(14900);
    expect(outstandingCharge(summary)?.id).toBe("charge-1");
    expect(summary.missingSections).toEqual([]);
  });

  it("mantém a conta visível quando uma seção agregada está indisponível", () => {
    const summary = parseBillingSummary({ ...summaryPayload, charges: undefined });

    expect(summary.state).toBe("active");
    expect(summary.charges).toEqual([]);
    expect(summary.missingSections).toEqual(["cobranças"]);
  });

  it("expõe somente as etapas persistidas que ainda impedem a ativação", () => {
    const summary = parseBillingSummary({
      ...summaryPayload,
      state: "onboarding",
      access: "none",
      onboarding: { missingItems: ["catalog", "cashier", "catalog"] },
    });

    expect(summary.onboarding?.missingItems).toEqual(["catalog", "cashier"]);
    expect(summary.missingSections).toEqual([]);
  });

  it("aceita a cotação do servidor e rejeita checkout com protocolo inseguro", () => {
    expect(
      parseUpgradeQuote({
        id: "quote-1",
        sourcePlanSlug: "operacao",
        targetPlanSlug: "crescimento",
        cycle: "monthly",
        periodEndsAt: "2026-09-01T00:00:00.000Z",
        amountCents: 7500,
        remainingRatio: 0.5,
        expiresAt: "2026-08-23T12:15:00.000Z",
        status: "pending",
      }).amountCents,
    ).toBe(7500);

    expect(() =>
      parseBillingCheckout({
        id: "checkout-1",
        status: "pending",
        url: "javascript:alert(1)",
        expiresAt: "2026-08-23T12:15:00.000Z",
        amountCents: 7500,
      }),
    ).toThrow("inseguro");
    expect(() =>
      parseBillingCheckout({
        id: "checkout-2",
        status: "pending",
        url: "http://checkout.example.test",
        expiresAt: "2026-08-23T12:15:00.000Z",
        amountCents: 7500,
      }),
    ).toThrow("inseguro");
  });

  it("remove a permissão de cobrança quando o owner entra em modo terminal", () => {
    const unit = { id: "unit-1", name: "Matriz", timezone: "America/Sao_Paulo" };
    const source = {
      identityId: "identity-1",
      identityName: "Marina Costa",
      platformAdmin: false,
      organizations: [
        {
          membershipId: "membership-1",
          organization: {
            id: "organization-1",
            name: "Grupo Aurora",
            document: "12.345.678/0001-90",
            units: [unit],
          },
          roles: [{ role: "owner" as const, unitId: null }],
        },
      ],
    };

    expect(
      sessionForScope(source, "organization-1", "unit-1", false)?.profile.permissions,
    ).toContain("billing.manage");
    expect(
      sessionForScope(source, "organization-1", "unit-1", true)?.profile.permissions,
    ).not.toContain("billing.manage");
  });
});
