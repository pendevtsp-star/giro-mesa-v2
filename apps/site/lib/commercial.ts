export type CommercialPlan = {
  slug: "operacao" | "crescimento" | "rede";
  name: string;
  monthlyPriceCents: number;
  annualPriceCents: number;
  includedUnits: number;
  description: string;
  featured?: boolean;
  features: string[];
};

export const demoPlans: CommercialPlan[] = [
  {
    slug: "operacao",
    name: "Operação",
    monthlyPriceCents: 14900,
    annualPriceCents: 149000,
    includedUnits: 1,
    description: "O núcleo completo para uma unidade funcionar sem remendos.",
    features: [
      "Salão, balcão, caixa e KDS",
      "QR na mesa e hub offline",
      "Estoque, compras e financeiro",
      "Usuários e dispositivos ilimitados",
    ],
  },
  {
    slug: "crescimento",
    name: "Crescimento",
    monthlyPriceCents: 29900,
    annualPriceCents: 299000,
    includedUnits: 1,
    description: "Canais próprios e relacionamento para vender com recorrência.",
    featured: true,
    features: [
      "Tudo do plano Operação",
      "Delivery e retirada próprios",
      "Fidelidade, cupons e campanhas",
      "Conciliação, automações e integrações",
    ],
  },
  {
    slug: "rede",
    name: "Rede",
    monthlyPriceCents: 49900,
    annualPriceCents: 499000,
    includedUnits: 3,
    description: "Controle central para operações com mais de uma unidade.",
    features: [
      "Tudo do plano Crescimento",
      "Até 3 unidades",
      "Gestão consolidada e auditoria",
      "API, webhooks e suporte prioritário",
    ],
  },
];

const descriptions: Record<CommercialPlan["slug"], string> = {
  operacao: "O núcleo completo para uma unidade funcionar sem remendos.",
  crescimento: "Canais próprios e relacionamento para vender com recorrência.",
  rede: "Controle central para operações com mais de uma unidade.",
};

const entitlementLabels: Record<string, string> = {
  salon: "Salão, mesas e comandas",
  counter: "Atendimento de balcão",
  kds: "Produção com KDS",
  cashier: "Caixa e turnos",
  offline_hub: "Hub para continuidade offline",
  qr_ordering: "Pedidos por QR na mesa",
  inventory: "Estoque e fichas técnicas",
  purchasing: "Compras e fornecedores",
  finance: "Financeiro operacional",
  basic_crm: "CRM básico",
  reports: "Relatórios de gestão",
  delivery: "Delivery próprio",
  pickup: "Pedidos para retirada",
  advanced_crm: "CRM e segmentação avançados",
  loyalty: "Fidelidade e benefícios",
  campaigns: "Cupons e campanhas",
  reconciliation: "Conciliação de recebimentos",
  integrations: "Central de integrações",
  all_growth: "Todos os recursos do Crescimento",
  multi_unit: "Gestão multiunidade",
  public_api: "API pública",
  webhooks: "Webhooks",
  advanced_audit: "Auditoria avançada",
  priority_sla: "Suporte prioritário",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeCommercialCatalog(payload: unknown): CommercialPlan[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.plans) || payload.plans.length === 0)
    return null;
  const normalized: CommercialPlan[] = [];

  for (const candidate of payload.plans) {
    if (!isRecord(candidate)) return null;
    const slug = candidate.slug;
    if (slug !== "operacao" && slug !== "crescimento" && slug !== "rede") return null;
    if (
      typeof candidate.name !== "string" ||
      !Number.isInteger(candidate.monthlyPriceCents) ||
      !Number.isInteger(candidate.annualPriceCents) ||
      !Number.isInteger(candidate.includedUnits) ||
      (candidate.monthlyPriceCents as number) < 0 ||
      (candidate.annualPriceCents as number) < 0 ||
      (candidate.includedUnits as number) < 1 ||
      !Array.isArray(candidate.entitlements) ||
      !candidate.entitlements.every((item) => typeof item === "string")
    ) {
      return null;
    }

    const features = candidate.entitlements
      .map((entitlement) => entitlementLabels[entitlement as string])
      .filter((label): label is string => Boolean(label));
    if (features.length === 0) return null;
    normalized.push({
      slug,
      name: candidate.name,
      monthlyPriceCents: candidate.monthlyPriceCents as number,
      annualPriceCents: candidate.annualPriceCents as number,
      includedUnits: candidate.includedUnits as number,
      description: descriptions[slug],
      featured: slug === "crescimento",
      features,
    });
  }

  return normalized;
}

export function annualPriceCents(monthlyPriceCents: number): number {
  if (!Number.isInteger(monthlyPriceCents) || monthlyPriceCents < 0) {
    throw new TypeError("O preço mensal deve ser um inteiro não negativo.");
  }
  return monthlyPriceCents * 10;
}

export function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

export async function getCommercialPlans(): Promise<{
  plans: CommercialPlan[];
  source: "api" | "demo";
}> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
  if (!apiUrl) return { plans: demoPlans, source: "demo" };

  try {
    const response = await fetch(`${apiUrl}/public/v1/commercial-catalog`, {
      next: { revalidate: 300 },
    });
    if (!response.ok) throw new Error("Catálogo indisponível");
    const plans = normalizeCommercialCatalog(await response.json());
    if (!plans) throw new Error("Catálogo inválido");
    return { plans, source: "api" };
  } catch {
    return { plans: demoPlans, source: "demo" };
  }
}
