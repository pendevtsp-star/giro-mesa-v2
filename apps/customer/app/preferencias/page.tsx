import { OptOutForm } from "../../components/opt-out-form";
import { normalizeOptOutToken } from "../../lib/public-contracts";

export default async function PreferencesPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const value = (await searchParams).token;
  const initialToken = normalizeOptOutToken(Array.isArray(value) ? value[0] : value) ?? "";

  return (
    <main className="preference-page">
      <a className="preference-back" href="/m/demo">
        ← Voltar ao cardápio
      </a>
      <p className="preference-eyebrow">Privacidade e comunicação</p>
      <h1>Gerencie sua preferência.</h1>
      <p className="preference-intro">
        Esta página executa apenas o descadastro por token emitido pelo estabelecimento. Pontos,
        cupons e cadastro de cliente continuam restritos ao ambiente autenticado da unidade.
      </p>
      <section className="preference-card" aria-labelledby="opt-out-title">
        <h2 id="opt-out-title">Não quero receber campanhas</h2>
        <p>Abra o link recebido ou cole abaixo o token fornecido na comunicação.</p>
        <OptOutForm initialToken={initialToken} />
      </section>
    </main>
  );
}
