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
      <a className="preference-back" href="/">
        ← Início
      </a>
      <p className="preference-eyebrow">Privacidade e comunicação</p>
      <h1>Gerencie sua preferência.</h1>
      <p className="preference-intro">
        Esta página serve apenas para interromper o envio de campanhas. Pontos, cupons e cadastro de
        cliente continuam sob responsabilidade da unidade.
      </p>
      <section className="preference-card" aria-labelledby="opt-out-title">
        <h2 id="opt-out-title">Não quero receber campanhas</h2>
        <p>Abra o link recebido ou cole abaixo o código de segurança enviado na comunicação.</p>
        <OptOutForm initialToken={initialToken} />
      </section>
    </main>
  );
}
