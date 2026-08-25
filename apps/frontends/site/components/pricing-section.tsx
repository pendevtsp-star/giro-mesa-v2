import Link from "next/link";
import {
  type CommercialAttribution,
  type CommercialOffer,
  type CommercialPlan,
  formatBRL,
  withCommercialAttribution,
} from "../lib/commercial";

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
}: {
  plans: CommercialPlan[];
  attribution?: CommercialAttribution;
}) {
  return (
    <section className="section plans-section" id="planos">
      <div className="container">
        <div className="section-heading centered">
          <p className="eyebrow">Planos publicados</p>
          <h2>Escolha a base da sua operação.</h2>
          <p>Preços, recursos e ofertas abaixo vêm do catálogo comercial vigente.</p>
        </div>
        <div className="plan-grid">
          {plans.map((plan) => (
            <article className={plan.featured ? "plan featured" : "plan"} key={plan.slug}>
              {plan.featured ? <span className="plan-badge">Destaque</span> : null}
              <h3>{plan.name}</h3>
              <p>{plan.description}</p>
              <div className="price">
                <small>mensal</small>
                {plan.offers.monthly.promotion ? (
                  <s>{formatBRL(plan.offers.monthly.originalPriceCents)}</s>
                ) : null}
                <strong>{formatBRL(plan.offers.monthly.priceCents)}</strong>
                <span>/mês</span>
              </div>
              <Promotion offer={plan.offers.monthly} />
              <p className="annual">
                Anual:{" "}
                {plan.offers.annual.promotion ? (
                  <>
                    <s>{formatBRL(plan.offers.annual.originalPriceCents)}</s>{" "}
                  </>
                ) : null}
                <strong>{formatBRL(plan.offers.annual.priceCents)}</strong>
              </p>
              {plan.offers.annual.promotion?.id !== plan.offers.monthly.promotion?.id ? (
                <Promotion offer={plan.offers.annual} />
              ) : null}
              <ul>
                {plan.features.map((feature) => (
                  <li key={feature}>✓ {feature}</li>
                ))}
              </ul>
              <Link
                className={plan.featured ? "button button-primary" : "button button-outline"}
                href={withCommercialAttribution(plan.ctaHref, attribution)}
              >
                {plan.ctaLabel}
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
