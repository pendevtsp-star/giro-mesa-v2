const screens = [
  {
    title: "Salão",
    description: "Mesas, comandas e prioridades reunidas na mesma visão operacional.",
  },
  {
    title: "Produção",
    description: "Fila do KDS organizada por estação, tempo e prioridade de preparo.",
  },
  {
    title: "Estoque",
    description: "Itens críticos, reposição e contagens disponíveis para decisão da equipe.",
  },
] as const;

export function ProductSection() {
  return (
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
          {screens.map((screen) => (
            <article className="product-shot" key={screen.title}>
              <div>
                <strong className="product-shot-title">{screen.title}</strong>
                <p className="product-shot-description">{screen.description}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
