import type { CommercialLanding } from "../lib/commercial";

export function FeaturesSection({
  benefits,
  howItWorks,
}: {
  benefits: CommercialLanding["benefits"];
  howItWorks: CommercialLanding["howItWorks"];
}) {
  return (
    <>
      <section className="section capabilities" id="solucoes">
        <div className="container">
          <div className="section-heading light">
            <p className="eyebrow">Benefícios publicados</p>
            <h2 id="produto">{benefits.title}</h2>
          </div>
          <div className="capability-grid">
            {benefits.items.map((item) => (
              <article key={item.title}>
                <span aria-hidden="true">{item.icon}</span>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="section" id="recursos">
        <div className="container two-column">
          <div className="section-heading">
            <p className="eyebrow">Como funciona</p>
            <h2>{howItWorks.title}</h2>
          </div>
          <ol className="steps">
            {howItWorks.steps.map((step, index) => (
              <li key={step.title}>
                <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}
