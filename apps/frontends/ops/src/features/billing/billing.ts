import type {
  BillingState,
  BillingUpgradeQuote,
  BillingCheckout as ContractBillingCheckout,
  BillingCycle as ContractBillingCycle,
  BillingSummary as ContractBillingSummary,
} from "@giromesa/contracts";

export type BillingCycle = ContractBillingCycle;
export type BillingSummary = ContractBillingSummary & { missingSections: string[] };
export type UpgradeQuote = BillingUpgradeQuote;
export type BillingCheckout = ContractBillingCheckout;
type BillingPlan = ContractBillingSummary["plans"][number];

const billingStates = new Set<BillingState>([
  "draft",
  "onboarding",
  "trial_active",
  "active",
  "grace",
  "restricted",
  "suspended",
  "canceled",
]);
const activationItems = new Set<string>([
  "business",
  "unit",
  "catalog",
  "team",
  "production",
  "cashier",
  "fiscalChoice",
  "training",
  "rehearsal",
]);

function row(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} inválido na resposta de cobrança.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} inválido na resposta de cobrança.`);
  }
  return value;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function cents(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} inválido na resposta de cobrança.`);
  }
  return value as number;
}

function plan(
  value: unknown,
): Pick<BillingPlan, "id" | "slug" | "name" | "includedUnits" | "entitlements"> {
  const candidate = row(value, "Plano");
  return {
    id: text(candidate.id, "Identificador do plano"),
    slug: text(candidate.slug, "Código do plano") as BillingPlan["slug"],
    name: text(candidate.name, "Nome do plano"),
    includedUnits: cents(candidate.includedUnits, "Quantidade de unidades"),
    entitlements: Array.isArray(candidate.entitlements)
      ? candidate.entitlements.filter((item): item is string => typeof item === "string")
      : [],
  };
}

export function parseBillingSummary(value: unknown): BillingSummary {
  const candidate = row(value, "Resumo");
  const state = text(candidate.state, "Estado") as BillingState;
  if (!billingStates.has(state)) throw new Error("Estado de cobrança desconhecido.");
  const missingSections: string[] = [];

  const current =
    candidate.current === null || candidate.current === undefined
      ? null
      : (() => {
          const item = row(candidate.current, "Assinatura atual");
          const source = item.source;
          if (source !== "trial" && source !== "subscription") {
            throw new Error("Origem da assinatura inválida.");
          }
          const cycle = item.cycle;
          if (cycle !== null && cycle !== "monthly" && cycle !== "annual") {
            throw new Error("Ciclo da assinatura inválido.");
          }
          const paymentMethod = item.paymentMethod;
          if (
            paymentMethod !== null &&
            paymentMethod !== "credit_card" &&
            paymentMethod !== "pix"
          ) {
            throw new Error("Meio de pagamento inválido.");
          }
          return {
            source: source as "trial" | "subscription",
            plan: plan(item.plan),
            cycle: cycle as BillingCycle | null,
            priceCents:
              item.priceCents === null ? null : cents(item.priceCents, "Preço contratado"),
            periodStartsAt: text(item.periodStartsAt, "Início do período"),
            periodEndsAt: text(item.periodEndsAt, "Fim do período"),
            renewsAutomatically: item.renewsAutomatically === true,
            paymentMethod: paymentMethod as "credit_card" | "pix" | null,
          };
        })();

  if (!Array.isArray(candidate.charges)) missingSections.push("cobranças");
  if (!Array.isArray(candidate.plans)) missingSections.push("planos disponíveis");
  if (!candidate.actions || typeof candidate.actions !== "object") {
    missingSections.push("ações de pagamento");
  }
  if (state === "onboarding" && !candidate.onboarding) {
    missingSections.push("etapas de ativação");
  }

  const onboarding = candidate.onboarding
    ? (() => {
        const item = row(candidate.onboarding, "Ativação");
        if (!Array.isArray(item.missingItems)) {
          throw new Error("Etapas pendentes inválidas na resposta de cobrança.");
        }
        const missingItems = item.missingItems.map((value) => {
          if (typeof value !== "string" || !activationItems.has(value)) {
            throw new Error("Etapa de ativação desconhecida.");
          }
          return value as NonNullable<BillingSummary["onboarding"]>["missingItems"][number];
        });
        return { missingItems: [...new Set(missingItems)] };
      })()
    : null;

  const actions =
    candidate.actions && typeof candidate.actions === "object" && !Array.isArray(candidate.actions)
      ? (candidate.actions as Record<string, unknown>)
      : {};

  return {
    state,
    access: text(candidate.access, "Modo de acesso") as BillingSummary["access"],
    onboarding,
    current,
    charges: (Array.isArray(candidate.charges) ? candidate.charges : []).map((value) => {
      const item = row(value, "Cobrança");
      return {
        id: text(item.id, "Identificador da cobrança"),
        amountCents: cents(item.amountCents, "Valor da cobrança"),
        status: text(item.status, "Situação da cobrança"),
        dueAt: text(item.dueAt, "Vencimento da cobrança"),
        paidAt: nullableText(item.paidAt),
        paymentUrl: nullableText(item.paymentUrl),
      };
    }),
    plans: (Array.isArray(candidate.plans) ? candidate.plans : []).map((value) => {
      const item = row(value, "Plano comercial");
      return {
        ...plan(item),
        monthlyPriceCents: cents(item.monthlyPriceCents, "Preço mensal"),
        annualPriceCents: cents(item.annualPriceCents, "Preço anual"),
        current: item.current === true,
        upgradeEligible: item.upgradeEligible === true,
      };
    }),
    actions: {
      onlinePaymentsEnabled: actions.onlinePaymentsEnabled === true,
      canSubscribe: actions.canSubscribe === true,
      canRegularize: actions.canRegularize === true,
      canUpgrade: actions.canUpgrade === true,
      unavailableReason: nullableText(actions.unavailableReason),
    },
    missingSections,
  };
}

export function parseUpgradeQuote(value: unknown): UpgradeQuote {
  const candidate = row(value, "Cotação");
  const cycle = candidate.cycle;
  if (cycle !== "monthly" && cycle !== "annual") throw new Error("Ciclo da cotação inválido.");
  if (typeof candidate.remainingRatio !== "number" || !Number.isFinite(candidate.remainingRatio)) {
    throw new Error("Proporção restante inválida na cotação.");
  }
  return {
    id: text(candidate.id, "Identificador da cotação"),
    sourcePlanSlug: text(candidate.sourcePlanSlug, "Plano atual"),
    targetPlanSlug: text(candidate.targetPlanSlug, "Plano de destino"),
    cycle,
    periodEndsAt: text(candidate.periodEndsAt, "Fim do período"),
    amountCents: cents(candidate.amountCents, "Valor da cotação"),
    remainingRatio: candidate.remainingRatio,
    expiresAt: text(candidate.expiresAt, "Validade da cotação"),
    status: text(candidate.status, "Situação da cotação") as UpgradeQuote["status"],
  };
}

export function parseBillingCheckout(value: unknown): BillingCheckout {
  const candidate = row(value, "Checkout");
  const url = text(candidate.url, "Endereço do checkout");
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("O provedor devolveu um endereço de checkout inválido.");
  }
  if (parsedUrl.protocol !== "https:") {
    throw new Error("O provedor devolveu um endereço de checkout inseguro.");
  }
  return {
    id: text(candidate.id, "Identificador do checkout"),
    status: text(candidate.status, "Situação do checkout") as BillingCheckout["status"],
    url: parsedUrl.toString(),
    expiresAt: text(candidate.expiresAt, "Validade do checkout"),
    amountCents: cents(candidate.amountCents, "Valor do checkout"),
  };
}

export function outstandingCharge(summary: BillingSummary) {
  const settled = new Set(["paid", "received", "confirmed", "refunded", "canceled"]);
  return summary.charges.find((charge) => !settled.has(charge.status.toLowerCase())) ?? null;
}
