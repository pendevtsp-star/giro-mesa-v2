import type { Metadata } from "next";
import { InstallDiagnostic } from "../../components/install-diagnostic";

export const metadata: Metadata = {
  title: "Instalar GiroMesa",
  description: "Instale o GiroMesa como PWA ou encontre o aplicativo homologado para sua SmartPOS.",
};

export const dynamic = "force-dynamic";

export default function InstallPage() {
  return (
    <main id="conteudo" className="inner-page install-page">
      <section className="simple-hero">
        <div className="container narrow">
          <p className="eyebrow">Instalação segura</p>
          <h1>GiroMesa no dispositivo certo.</h1>
          <p>
            Use a PWA em celulares, tablets e computadores. Em maquininhas SmartPOS, instale apenas
            pelo canal homologado da adquirente.
          </p>
        </div>
      </section>
      <div className="container install-page-content">
        <InstallDiagnostic
          opsUrl={process.env.NEXT_PUBLIC_OPS_URL}
          redeStoreUrl={process.env.NEXT_PUBLIC_REDE_STORE_URL}
          paygoStoreUrl={process.env.NEXT_PUBLIC_PAYGO_STORE_URL}
          stoneStoreUrl={process.env.NEXT_PUBLIC_STONE_STORE_URL}
        />
        <section className="install-expectations" aria-labelledby="install-expectations-title">
          <h2 id="install-expectations-title">Como a cobrança funciona</h2>
          <ol>
            <li>O garçom informa valor, método e parcelas no GiroMesa.</li>
            <li>A maquininha abre a tela bancária segura para cartão ou Pix.</li>
            <li>O GiroMesa retorna à mesma comanda e confirma somente o resultado autenticado.</li>
          </ol>
          <p>
            Se o retorno for interrompido, a comanda mostra{" "}
            <strong>resultado não confirmado</strong> e exige verificação antes de permitir nova
            cobrança.
          </p>
        </section>
      </div>
    </main>
  );
}
