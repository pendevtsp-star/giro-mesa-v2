import type { CommercialPlan } from "./commercial";

export type BillingCycle = "monthly" | "annual";

export function pricingAmounts(plan: CommercialPlan, cycle: BillingCycle) {
  const offer = plan.offers[cycle];
  return {
    offer,
    monthlyEquivalent: cycle === "annual" ? Math.round(offer.priceCents / 12) : null,
    savings:
      cycle === "annual" && !plan.offers.monthly.promotion
        ? Math.max(0, plan.offers.monthly.priceCents * 12 - offer.priceCents)
        : 0,
  };
}

export function withPlanSelection(href: string, plan: CommercialPlan["slug"], cycle: BillingCycle) {
  const url = new URL(href, "https://site.giromesa.local");
  if (
    url.origin !== "https://site.giromesa.local" ||
    !["/criar-conta", "/teste-gratis"].includes(url.pathname)
  )
    return href;
  url.searchParams.set("plano", plan);
  url.searchParams.set("ciclo", cycle);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function readPlanSelection(search: string) {
  const parameters = new URLSearchParams(search);
  const plan = parameters.get("plano");
  const cycle = parameters.get("ciclo");
  if (
    (plan !== "operacao" && plan !== "crescimento" && plan !== "rede") ||
    (cycle !== "monthly" && cycle !== "annual")
  )
    return null;
  return { plan, cycle };
}
