import Image from "next/image";
import Link from "next/link";
import { formatBRL, getCommercialPlans } from "../lib/commercial";

const capabilities = [
  [
    "01",
    "Atendimento sem atrito",
    "Mesas, comandas, balcão, divisão de conta e QR conversam com o mesmo pedido.",
  ],
  [
    "02",
    "Produção no ritmo",
    "KDS por estação, impressão e prioridades ajudam cozinha e bar a trabalhar com contexto.",
  ],
  [
    "03",
    "Estoque conectado",
    "Fichas técnicas transformam vendas em consumo e tornam rupturas e perdas visíveis.",
  ],
  [
    "04",
    "Caixa responsável",
    "Turnos, aprovações, pagamentos e conciliação preservam uma trilha auditável.",
  ],
  [
    "05",
    "Gestão acionável",
    "Indicadores começam nas exceções que pedem decisão, não em gráficos decorativos.",
  ],
  [
    "06",
    "Continuidade local",
    "O hub planejado mantém a operação essencial da unidade durante falhas de internet.",
  ],
] as const;

const segments = ["Restaurante", "Bar", "Lanchonete", "Cafeteria", "Pizzaria", "Operação em rede"];

const productScreens = [
  {
    src: "/images/product/salon.png",
    title: "Salão",
    description: "Mesas, comandas e prioridades reunidas na mesma visão operacional.",
    alt: "Tela demonstrativa do salão GiroMesa com mapa de mesas e estados de atendimento",
  },
  {
    src: "/images/product/kds.png",
    title: "Produção",
    description: "Fila do KDS organizada por estação, tempo e prioridade de preparo.",
    alt: "Tela demonstrativa do KDS GiroMesa com pedidos distribuídos por etapa de produção",
  },
  {
    src: "/images/product/inventory.png",
    title: "Estoque",
    description: "Itens críticos, reposição e contagens disponíveis para decisão da equipe.",
    alt: "Tela demonstrativa do estoque GiroMesa com itens, quantidades e alertas de reposição",
  },
] as const;

export default async function Home() {
  const catalog = await getCommercialPlans();
  return (
    <main id="conteudo">
      <section className="hero">
        <div className="hero-glow" aria-hidden="true" />
        <div className="container hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">
              <span /> Gestão operacional para food service
            </p>
            <h1>
              O salão gira.
              <br />
              <em>A gestão acompanha.</em>
            </h1>
            <p className="hero-lead">
              Pedidos, produção, estoque, caixa e decisões conectados em uma operação feita para o
              ritmo real do seu negócio.
            </p>
            <div className="hero-actions">
              <Link className="button button-primary button-large" href="/teste-gratis">
                Testar 14 dias grátis <span>→</span>
              </Link>
              <a className="button button-outline button-large" href="#produto">
                Ver demonstração
              </a>
            </div>
            <p className="microcopy">
              Sem cartão · ativação assistida · o período começa quando sua operação estiver pronta
            </p>
          </div>
          <figure className="hero-product">
            <div className="hero-product-frame">
              <Image
                alt="Dashboard demonstrativo do GiroMesa com alertas e indicadores da unidade"
                height={1054}
                priority
                sizes="(max-width: 960px) calc(100vw - 40px), 56vw"
                src="/images/product/dashboard.png"
                width={1440}
              />
            </div>
            <figcaption>
              <span className="product-demo-badge">Ambiente demonstrativo</span>
              Dashboard com visão operacional por perfil.
            </figcaption>
          </figure>
        </div>
        <div className="container segment-strip">
          <span>Uma base para diferentes operações</span>
          {segments.map((segment) => (
            <b className="segment-name" key={segment}>
              {segment}
            </b>
          ))}
        </div>
      </section>

      <section className="section flow-section" id="produto">
        <div className="container">
          <div className="section-heading">
            <p className="eyebrow">Uma só verdade operacional</p>
            <h2>
              Do pedido à decisão,
              <br />
              sem ilhas no caminho.
            </h2>
            <p>Veja como uma informação atravessa a operação sem ser digitada de novo.</p>
          </div>
          <div className="product-gallery">
            {productScreens.map((screen) => (
              <figure className="product-shot" key={screen.title}>
                <div className="product-shot-frame">
                  <Image
                    alt={screen.alt}
                    height={900}
                    loading="lazy"
                    sizes="(max-width: 720px) calc(100vw - 28px), (max-width: 1180px) calc(50vw - 34px), 570px"
                    src={screen.src}
                    width={1440}
                  />
                </div>
                <figcaption>
                  <span className="product-demo-badge product-shot-badge">
                    Ambiente demonstrativo
                  </span>
                  <strong className="product-shot-title">{screen.title}</strong>
                  <p className="product-shot-description">{screen.description}</p>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section className="section capabilities" id="solucoes">
        <div className="container">
          <div className="section-heading light">
            <p className="eyebrow">Feito para o turno real</p>
            <h2>
              Menos improviso.
              <br />
              Mais controle.
            </h2>
          </div>
          <div className="capability-grid">
            {capabilities.map(([number, title, text]) => (
              <article key={number}>
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="recursos">
        <div className="container two-column">
          <div className="section-heading">
            <p className="eyebrow">Implantação responsável</p>
            <h2>O teste começa quando a casa está pronta.</h2>
            <p>Em vez de entregar uma senha e contar dias, organizamos a ativação com você.</p>
          </div>
          <ol className="steps">
            <li>
              <span>01</span>
              <div>
                <h3>Entendemos a operação</h3>
                <p>Unidade, canais, equipe, equipamentos e necessidades fiscais.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Configuramos a base</h3>
                <p>Cardápio, mesas, produção, usuários, caixa e permissões.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Simulamos o turno</h3>
                <p>Pedido, produção, pagamento, emissão e fechamento antes da ativação.</p>
              </div>
            </li>
            <li>
              <span>04</span>
              <div>
                <h3>Ativamos os 14 dias</h3>
                <p>O período gratuito começa após a aprovação operacional.</p>
              </div>
            </li>
          </ol>
        </div>
      </section>

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
          {catalog.source === "demo" && (
            <p className="catalog-note">
              Valores previstos no plano comercial; publicação final depende da ativação do
              catálogo.
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

      <section className="section trust-section">
        <div className="container trust-grid">
          <div>
            <p className="eyebrow">Integrações e confiança</p>
            <h2>Promessas só depois de homologadas.</h2>
            <p>
              PayGo, Focus NFe, Asaas, WhatsApp e outros provedores aparecem como integrações
              planejadas até que contratos, credenciais e testes reais comprovem a disponibilidade.
            </p>
          </div>
          <div className="trust-cards">
            <article>
              <span>◈</span>
              <h3>Privacidade por projeto</h3>
              <p>Permissões, auditoria, retenção e exportação pensadas para a LGPD.</p>
            </article>
            <article>
              <span>⌁</span>
              <h3>Operação local planejada</h3>
              <p>
                Hub por unidade para manter pedidos, KDS e impressão durante quedas de internet.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="section faq-section">
        <div className="container narrow">
          <div className="section-heading centered">
            <p className="eyebrow">Perguntas frequentes</p>
            <h2>Antes de começar</h2>
          </div>
          <div className="faq-list">
            <details>
              <summary>Preciso cadastrar cartão para testar?</summary>
              <p>
                Não. O teste assistido de 14 dias não exige cartão e só começa após a ativação da
                operação.
              </p>
            </details>
            <details>
              <summary>O GiroMesa funciona sem internet?</summary>
              <p>
                A continuidade offline depende do aplicativo e hub local. Ela será disponibilizada
                comercialmente somente após a homologação do piloto.
              </p>
            </details>
            <details>
              <summary>Emissão fiscal está incluída?</summary>
              <p>
                Não. O módulo fiscal é adicional por unidade, e a contratação exige configuração
                fiscal ou declaração de emissor externo.
              </p>
            </details>
            <details>
              <summary>Posso usar em várias unidades?</summary>
              <p>Sim. O plano Rede parte de até três unidades e oferece visão consolidada.</p>
            </details>
            <details>
              <summary>Vocês ajudam na configuração?</summary>
              <p>
                O onboarding e treinamento remoto fazem parte da ativação. Instalações presenciais,
                rede e equipamentos podem ser cobrados à parte.
              </p>
            </details>
          </div>
        </div>
      </section>

      <section className="final-cta">
        <div className="container">
          <p className="eyebrow">Seu próximo turno começa aqui</p>
          <h2>
            Uma operação que gira
            <br />
            sem perder o controle.
          </h2>
          <div>
            <Link className="button button-light button-large" href="/teste-gratis">
              Solicitar teste assistido →
            </Link>
            <Link className="button button-dark button-large" href="/contato">
              Falar com especialista
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
