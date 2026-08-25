import type { Metadata } from "next";
import { headers } from "next/headers";
import { LeadForm } from "../../components/lead-form";
import {
  commercialAttributionForCatalog,
  commercialAttributionFromSearchParams,
  commercialVisitorId,
  getCommercialCatalog,
} from "../../lib/commercial";

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
  const visitorId = commercialVisitorId((await headers()).get("x-giromesa-visitor-id"));
  const [parameters, catalogState] = await Promise.all([
    searchParams,
    getCommercialCatalog(visitorId),
  ]);
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
          {catalogState.catalog ? (
            <LeadForm
              attribution={commercialAttributionForCatalog(
                commercialAttributionFromSearchParams(parameters),
                catalogState.catalog,
                visitorId,
              )}
              kind="contact"
              initialMessage={initialMessage}
            />
          ) : (
            <p className="catalog-note" role="status">
              Mensagens temporariamente indisponíveis. Nenhum dado foi enviado.
            </p>
          )}
        </aside>
      </section>
    </main>
  );
}
