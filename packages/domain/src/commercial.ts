export const COMMERCIAL_PLANS = [
  {
    slug: "operacao",
    name: "Operação",
    description: "O núcleo completo para uma unidade funcionar sem remendos.",
    features: [
      "Salão, balcão, caixa e KDS",
      "QR na mesa e hub offline",
      "Estoque, compras e financeiro",
      "Usuários e dispositivos ilimitados",
    ],
    monthlyPriceCents: 14_900,
    includedUnits: 1,
    entitlements: [
      "salon",
      "counter",
      "kds",
      "cashier",
      "offline_hub",
      "qr_ordering",
      "inventory",
      "purchasing",
      "finance",
      "basic_crm",
      "reports",
    ],
  },
  {
    slug: "crescimento",
    name: "Crescimento",
    description: "Canais próprios e relacionamento para vender com recorrência.",
    featured: true,
    features: [
      "Tudo do plano Operação",
      "Delivery e retirada próprios",
      "Fidelidade, cupons e campanhas",
      "Conciliação, automações e integrações",
    ],
    monthlyPriceCents: 29_900,
    includedUnits: 1,
    entitlements: [
      "salon",
      "counter",
      "kds",
      "cashier",
      "offline_hub",
      "qr_ordering",
      "inventory",
      "purchasing",
      "finance",
      "basic_crm",
      "reports",
      "delivery",
      "pickup",
      "advanced_crm",
      "loyalty",
      "campaigns",
      "reconciliation",
      "integrations",
    ],
  },
  {
    slug: "rede",
    name: "Rede",
    description: "Controle central para operações com mais de uma unidade.",
    features: [
      "Tudo do plano Crescimento",
      "Até 3 unidades",
      "Gestão consolidada e auditoria",
      "API, webhooks e suporte prioritário",
    ],
    monthlyPriceCents: 49_900,
    includedUnits: 3,
    entitlements: [
      "all_growth",
      "multi_unit",
      "public_api",
      "webhooks",
      "advanced_audit",
      "priority_sla",
    ],
  },
] as const;

export const ANNUAL_MONTH_MULTIPLIER = 10;

export type CommercialPlanSlug = (typeof COMMERCIAL_PLANS)[number]["slug"];

export function getCommercialPlan(slug: string) {
  return COMMERCIAL_PLANS.find((plan) => plan.slug === slug);
}
