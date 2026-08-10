import assert from "node:assert/strict";
import test from "node:test";
import { annualPriceCents, demoPlans, normalizeCommercialCatalog } from "./commercial.ts";

test("o anual equivale a dez mensalidades", () => {
  assert.equal(annualPriceCents(14900), 149000);
});

test("o catálogo de demonstração contém os três planos publicados", () => {
  assert.deepEqual(
    demoPlans.map((plan) => plan.name),
    ["Operação", "Crescimento", "Rede"],
  );
});

test("preços inválidos são rejeitados", () => {
  assert.throws(() => annualPriceCents(-1), TypeError);
});

test("normaliza o contrato real do catálogo sem confiar no JSON", () => {
  const plans = normalizeCommercialCatalog({
    plans: [
      {
        slug: "operacao",
        name: "Operação",
        monthlyPriceCents: 14900,
        annualPriceCents: 149000,
        includedUnits: 1,
        entitlements: ["salon", "qr_ordering"],
      },
    ],
  });
  assert.equal(plans?.[0]?.features[1], "Pedidos por QR na mesa");
  assert.equal(normalizeCommercialCatalog({ plans: [{ slug: "invalido" }] }), null);
});
