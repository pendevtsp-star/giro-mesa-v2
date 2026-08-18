import type { Metadata } from "next";
import { LeadForm } from "../../components/lead-form";

export const metadata: Metadata = { title: "Teste assistido de 14 dias" };

export default async function TrialPage({
  searchParams,
}: {
  searchParams: Promise<{ plano?: string }>;
}) {
  const { plano } = await searchParams;
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
          <LeadForm kind="trial" initialPlan={initialPlan} />
        </aside>
      </section>
    </main>
  );
}
