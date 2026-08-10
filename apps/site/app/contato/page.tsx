import type { Metadata } from "next";
import { LeadForm } from "../../components/lead-form";

export const metadata: Metadata = { title: "Contato" };

export default function ContactPage() {
  return (
    <main id="conteudo" className="inner-page">
      <section className="inner-hero container">
        <div className="inner-hero-copy">
          <p className="eyebrow">Conversa direta</p>
          <h1>Conte como sua operação gira hoje.</h1>
          <p>
            Vendas, parcerias e dúvidas gerais entram por aqui. Para problemas em uma conta
            existente, use a central de suporte.
          </p>
          <div className="contact-cards">
            <article>
              <h2>Comercial</h2>
              <p>Planos, implantação e avaliação da unidade.</p>
            </article>
            <article>
              <h2>Suporte</h2>
              <p>Clientes identificados recebem contexto e prioridade pelo canal autenticado.</p>
            </article>
          </div>
        </div>
        <aside>
          <h2>Enviar mensagem</h2>
          <LeadForm kind="contact" />
        </aside>
      </section>
    </main>
  );
}
