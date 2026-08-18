import Link from "next/link";

const segments = ["Restaurante", "Bar", "Lanchonete", "Cafeteria", "Pizzaria", "Operação em rede"];

export function Hero() {
  return (
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
              Conhecer o produto
            </a>
          </div>
          <p className="microcopy">
            Sem cartão · ativação assistida · o período começa quando sua operação estiver pronta
          </p>
        </div>
        <section className="hero-product" aria-label="Resumo operacional do GiroMesa">
          <div className="hero-product-frame">
            <p className="eyebrow">Operação conectada</p>
            <h2>Atendimento, produção e gestão na mesma base.</h2>
            <p>Permissões, auditoria e dados por unidade acompanham cada fluxo real.</p>
          </div>
        </section>
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
  );
}
