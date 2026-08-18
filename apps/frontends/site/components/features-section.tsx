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

const steps = [
  ["01", "Entendemos a operação", "Unidade, canais, equipe, equipamentos e necessidades fiscais."],
  ["02", "Configuramos a base", "Cardápio, mesas, produção, usuários, caixa e permissões."],
  [
    "03",
    "Simulamos o turno",
    "Pedido, produção, pagamento, emissão e fechamento antes da ativação.",
  ],
  ["04", "Ativamos os 14 dias", "O período gratuito começa após a aprovação operacional."],
] as const;

export function FeaturesSection() {
  return (
    <>
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
            {steps.map(([number, title, text]) => (
              <li key={number}>
                <span>{number}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}
