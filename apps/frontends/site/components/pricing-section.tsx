"use client";

import { Icon } from "@giromesa/ui";
import Link from "next/link";
import { useId, useState } from "react";
import {
  type CommercialAttribution,
  type CommercialOffer,
  type CommercialPlan,
  formatBRL,
  withCommercialAttribution,
} from "../lib/commercial";
import { type BillingCycle, pricingAmounts, withPlanSelection } from "../lib/pricing";

function Promotion({ offer }: { offer: CommercialOffer }) {
  if (!offer.promotion) return null;
  return (
    <p className="promotion-note">
      <strong>{offer.promotion.name}</strong>
      {offer.promotion.endsAt ? (
        <span>
          até{" "}
          <time dateTime={offer.promotion.endsAt}>
            {new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(
              new Date(offer.promotion.endsAt),
            )}
          </time>
        </span>
      ) : null}
    </p>
  );
}

export function PricingSection({
  plans,
  attribution,
  initialCycle = "monthly",
}: {
  plans: CommercialPlan[];
  attribution?: CommercialAttribution;
  initialCycle?: BillingCycle;
}) {
  const [cycle, setCycle] = useState<BillingCycle>(initialCycle);
  const cycleId = useId();
  return (
    <section className="section plans-section" id="planos" aria-labelledby="planos-title">
      <div className="container">
        <div className="section-heading">
          <h2 id="planos-title">Escolha a base da sua operação.</h2>
        </div>
        <fieldset className="billing-toggle">
          <legend className="pricing-sr-only">Período de cobrança</legend>
          {(["monthly", "annual"] as const).map((value) => (
            <label key={value}>
              <input
                type="radio"
                name={cycleId}
                value={value}
                checked={cycle === value}
                onChange={() => setCycle(value)}
              />
              <span>{value === "monthly" ? "Mensal" : "Anual"}</span>
            </label>
          ))}
        </fieldset>
        <div className="plan-grid">
          {plans.map((plan) => {
            const { offer, monthlyEquivalent, savings } = pricingAmounts(plan, cycle);
            return (
              <article className={plan.featured ? "plan featured" : "plan"} key={plan.slug}>
                {plan.featured ? <span className="plan-badge">Plano em destaque</span> : null}
                <h3>{plan.name}</h3>
                <p className="plan-description">{plan.description}</p>
                <p className="plan-units">
                  <Icon name="multiunit" size={16} />
                  {plan.includedUnits === 1
                    ? "1 unidade incluída"
                    : `Até ${plan.includedUnits} unidades incluídas`}
                </p>
                <div className="plan-price-block" key={cycle}>
                  <div className="price">
                    {offer.promotion ? <s>{formatBRL(offer.originalPriceCents)}</s> : null}
                    <strong>{formatBRL(offer.priceCents)}</strong>
                    <span>{cycle === "monthly" ? "/mês" : "/ano"}</span>
                  </div>
                  <p className="plan-equivalent">
                    {monthlyEquivalent !== null
                      ? `Equivale a ${formatBRL(monthlyEquivalent)}/mês no período anual.`
                      : "Valor do período mensal."}
                  </p>
                  {savings > 0 ? (
                    <p className="plan-savings">
                      Economize {formatBRL(savings)} em relação a 12 mensalidades.
                    </p>
                  ) : null}
                  <Promotion offer={offer} />
                </div>
                <ul>
                  {plan.features.map((feature) => (
                    <li key={feature}>
                      <Icon name="check" size={17} />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  className={plan.featured ? "button button-primary" : "button button-outline"}
                  href={withPlanSelection(
                    withCommercialAttribution(plan.ctaHref, attribution),
                    plan.slug,
                    cycle,
                  )}
                  aria-label={`${plan.ctaLabel} — ${plan.name}, ${cycle === "monthly" ? "mensal" : "anual"}`}
                >
                  {plan.ctaLabel}
                </Link>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
