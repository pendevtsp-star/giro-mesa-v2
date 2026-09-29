import assert from "node:assert/strict";
import test from "node:test";
import type { CommercialPlan } from "./commercial";
import { pricingAmounts, readPlanSelection, withPlanSelection } from "./pricing.ts";

const plan: CommercialPlan = {
  slug: "operacao",
  name: "Operação",
  description: "",
  features: [],
  entitlements: [],
  includedUnits: 1,
  featured: false,
  displayOrder: 1,
  ctaHref: "/criar-conta",
  ctaLabel: "Criar conta",
  monthlyPriceCents: 14900,
  annualPriceCents: 149000,
  offers: {
    monthly: { priceCents: 14900, originalPriceCents: 14900, promotion: null },
    annual: { priceCents: 149000, originalPriceCents: 149000, promotion: null },
  },
};

test("usa a oferta publicada e calcula equivalência sem transformar o anual em mensalidade", () => {
  assert.equal(pricingAmounts(plan, "monthly").offer.priceCents, 14900);
  assert.equal(pricingAmounts(plan, "monthly").monthlyEquivalent, null);
  const annual = pricingAmounts(plan, "annual");
  assert.equal(annual.offer.priceCents, 149000);
  assert.equal(annual.monthlyEquivalent, 12417);
  assert.equal(annual.savings, 29800);
  const promoted = structuredClone(plan);
  promoted.offers.monthly = {
    priceCents: 10000,
    originalPriceCents: 14900,
    promotion: { id: "promo", name: "Promoção", type: "price", value: 10000, endsAt: null },
  };
  assert.equal(pricingAmounts(promoted, "annual").savings, 0);
  const expensiveAnnual = structuredClone(plan);
  expensiveAnnual.offers.annual.priceCents = 200000;
  assert.equal(pricingAmounts(expensiveAnnual, "annual").savings, 0);
});

test("preserva atribuição e limita a preferência a destinos e valores conhecidos", () => {
  assert.equal(
    withPlanSelection("/criar-conta?landing_version=1#inicio", "rede", "annual"),
    "/criar-conta?landing_version=1&plano=rede&ciclo=annual#inicio",
  );
  assert.equal(
    withPlanSelection("https://example.com/criar-conta", "rede", "annual"),
    "https://example.com/criar-conta",
  );
  assert.equal(withPlanSelection("/contato", "rede", "annual"), "/contato");
  assert.deepEqual(readPlanSelection("?plano=rede&ciclo=annual"), {
    plan: "rede",
    cycle: "annual",
  });
  assert.equal(readPlanSelection("?plano=inventado&ciclo=annual"), null);
  assert.equal(readPlanSelection("?plano=rede&ciclo=free"), null);
  assert.equal(readPlanSelection(""), null);
});
