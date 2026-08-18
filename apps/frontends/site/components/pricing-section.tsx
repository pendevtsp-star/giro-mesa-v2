import Link from "next/link";
import { type CommercialPlan, formatBRL } from "../lib/commercial";

export function PricingSection({
  catalog,
}: {
  catalog: { plans: CommercialPlan[]; source: "api" | "unavailable" };
}) {
  return (
    <section className="section plans-section" id="planos">
      <div className="container">
        <div className="section-heading centered">
          <p className="eyebrow">Planos transparentes</p>
          <h2>Comece completo. Cresça quando fizer sentido.</h2>
          <p>
            Usuários e dispositivos ilimitados por unidade. Fiscal e serviços de parceiros são
            adicionais.
          </p>
        </div>
        {catalog.source === "unavailable" && (
          <p className="catalog-note">
            Planos temporariamente indisponíveis. Fale com nossa equipe.
          </p>
        )}
        <div className="plan-grid">
          {catalog.plans.map((plan) => (
            <article className={plan.featured ? "plan featured" : "plan"} key={plan.name}>
              {plan.featured && <span className="plan-badge">Mais completo para crescer</span>}
              <h3>{plan.name}</h3>
              <p>{plan.description}</p>
              <div className="price">
                <small>a partir de</small>
                <strong>{formatBRL(plan.monthlyPriceCents)}</strong>
                <span>/mês</span>
              </div>
              <p className="annual">Anual: {formatBRL(plan.annualPriceCents)}</p>
              <ul>
                {plan.features.map((feature) => (
                  <li key={feature}>✓ {feature}</li>
                ))}
              </ul>
              <Link
                className={plan.featured ? "button button-primary" : "button button-outline"}
                href={`/teste-gratis?plano=${plan.slug}`}
              >
                Testar este plano
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
