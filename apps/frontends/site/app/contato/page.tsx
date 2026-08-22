import type { Metadata } from "next";
import { LeadForm } from "../../components/lead-form";

export const metadata: Metadata = { title: "Contato" };

function readQueryValue(value: string | string[] | undefined, maxLength: number) {
  const selected = Array.isArray(value) ? value[0] : value;
  return selected?.trim().slice(0, maxLength) ?? "";
}

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parameters = await searchParams;
  const smartPosRequest = readQueryValue(parameters.assunto, 60) === "homologacao-smartpos";
  const provider = readQueryValue(parameters.fornecedor, 40);
  const model = readQueryValue(parameters.modelo, 120);
  const firmware = readQueryValue(parameters.firmware, 120);
  const initialMessage = smartPosRequest
    ? `Quero homologar uma SmartPOS para o GiroMesa.\nFornecedor: ${provider || "não informado"}\nModelo: ${model || "não informado"}\nAndroid/firmware: ${firmware || "não informado"}`
    : "";
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
          <LeadForm kind="contact" initialMessage={initialMessage} />
        </aside>
      </section>
    </main>
  );
}
