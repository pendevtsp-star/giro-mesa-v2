import type { Metadata } from "next";
import { headers } from "next/headers";
import { LeadForm } from "../../components/lead-form";
import {
  commercialAttributionForCatalog,
  commercialAttributionFromSearchParams,
  commercialVisitorId,
  getCommercialCatalog,
} from "../../lib/commercial";

export const metadata: Metadata = { title: "Teste assistido de 14 dias" };

export default async function TrialPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const visitorId = commercialVisitorId((await headers()).get("x-giromesa-visitor-id"));
  const [parameters, catalogState] = await Promise.all([
    searchParams,
    getCommercialCatalog(visitorId),
  ]);
  const plano = Array.isArray(parameters.plano) ? parameters.plano[0] : parameters.plano;
  const initialPlan =
    plano === "crescimento" || plano === "rede" || plano === "operacao" ? plano : "operacao";
  return (
    <main id="conteudo" className="inner-page trial-page">
      <section className="inner-hero container">
        <div className="inner-hero-copy">
          <p className="eyebrow">14 dias, sem cartão</p>
          <h1>Teste uma operação configurada para funcionar.</h1>
          <p>
            Conversamos sobre a casa, preparamos a base, simulamos o fluxo e só então ativamos o
            período gratuito.
          </p>
          <ul className="feature-checks">
            <li>Configuração e treinamento remoto incluídos</li>
            <li>Plano escolhido liberado durante o teste</li>
            <li>Sem cobrança automática ou surpresa</li>
          </ul>
        </div>
        <aside>
          <h2>Solicitar avaliação</h2>
          <p>Preencha os dados e retornaremos para entender o cenário.</p>
          {catalogState.catalog ? (
            <LeadForm
              attribution={commercialAttributionForCatalog(
                commercialAttributionFromSearchParams(parameters),
                catalogState.catalog,
                visitorId,
              )}
              kind="trial"
              initialPlan={initialPlan}
            />
          ) : (
            <p className="catalog-note" role="status">
              Solicitações temporariamente indisponíveis. Nenhum dado foi enviado.
            </p>
          )}
        </aside>
      </section>
    </main>
  );
}
