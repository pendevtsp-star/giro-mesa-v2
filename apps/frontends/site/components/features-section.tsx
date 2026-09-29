import { Icon, type IconName } from "@giromesa/ui";
import type { CommercialLanding } from "../lib/commercial";
import { ProductShowcase, type ProductSlide } from "./product-showcase";

const benefitIcons: Record<string, IconName> = {
  "Atendimento sem atrito": "salon",
  "Produção no ritmo": "kds",
  "Estoque conectado": "inventory",
  "Caixa responsável": "cash",
  "Gestão acionável": "finance",
  "Continuidade local": "multiunit",
  operations: "salon",
  insights: "inventory",
  finance: "cash",
  growth: "finance",
  security: "multiunit",
};

const activationIcons: Record<string, IconName> = {
  "Entendemos a operação": "people",
  "Configuramos a base": "settings",
  "Simulamos o turno": "check",
  "Ativamos os 14 dias": "clock",
};

const activationDetails: Record<string, string> = {
  "Entendemos a operação":
    "Mapeamos o atendimento da unidade: mesas e comandas, balcão, retirada e QR. Equipe, equipamentos e necessidades fiscais também entram nessa preparação.",
  "Configuramos a base":
    "Organizamos produtos e preços do cardápio, mesas, estações de produção e acesso da equipe. Caixa e permissões fazem parte da mesma configuração.",
  "Simulamos o turno":
    "Percorremos o caminho do pedido: atendimento, envio à produção, pagamento e fechamento. A simulação permite conferir a rotina antes da ativação.",
  "Ativamos os 14 dias":
    "A preparação acontece antes da contagem do teste. Os 14 dias gratuitos começam após a aprovação operacional, com a base configurada e o turno simulado.",
};

export function FeaturesSection({
  benefits,
  howItWorks,
  slides = [],
}: {
  benefits: CommercialLanding["benefits"];
  howItWorks: CommercialLanding["howItWorks"];
  slides?: ProductSlide[];
}) {
  return (
    <>
      {slides.length > 0 ? (
        <section className="section product-section" id="produto" aria-labelledby="product-title">
          <div className="container">
            <div className="section-heading">
              <h2 id="product-title">Seu dia a dia, em uma só operação.</h2>
            </div>
            <ProductShowcase slides={slides} />
          </div>
        </section>
      ) : null}
      <section
        className="section capabilities"
        id="solucoes"
        aria-labelledby={slides.length ? "benefits-title" : "produto"}
      >
        <div className="container">
          <div className="section-heading">
            <h2 id={slides.length ? "benefits-title" : "produto"}>{benefits.title}</h2>
          </div>
          <div className="capability-grid">
            {benefits.items.map((item) => (
              <article key={item.title}>
                <span className="capability-icon" aria-hidden="true">
                  <Icon
                    name={benefitIcons[item.title] ?? benefitIcons[item.icon] ?? "platform"}
                    size={28}
                  />
                </span>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="section getting-started" id="recursos" aria-labelledby="como-funciona">
        <div className="container">
          <div className="section-heading">
            <h2 id="como-funciona">{howItWorks.title}</h2>
          </div>
          <ol className="activation-journey">
            {howItWorks.steps.map((step, index) => (
              <li key={step.title}>
                <span className="activation-step__marker" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <details className="activation-step__card" name="activation-step">
                  <summary>
                    <Icon name={activationIcons[step.title] ?? "check"} size={28} />
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                    <span className="activation-step__hint">
                      Detalhes da etapa <Icon name="chevron-down" size={16} />
                    </span>
                  </summary>
                  <p className="activation-step__detail">
                    {activationDetails[step.title] ?? step.description}
                  </p>
                </details>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}
