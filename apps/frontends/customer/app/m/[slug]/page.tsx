import type { Metadata } from "next";
import { MenuExperience } from "../../../components/menu-experience";
import { getPublicMenu } from "../../../lib/api";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const menu = await getPublicMenu(slug);
  const name = menu.branding?.displayName;
  return {
    title: name ? `Cardápio | ${name}` : "Cardápio | GiroMesa",
    description:
      menu.branding?.slogan ?? menu.branding?.notice ?? "Cardápio digital e atendimento na mesa.",
  };
}

export default async function PublicMenuPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const menu = await getPublicMenu(slug);
  if (menu.source === "unavailable") {
    return (
      <main className="public-state">
        <span className="public-state-mark" aria-hidden="true">
          !
        </span>
        <p className="public-state-eyebrow">Cardápio indisponível</p>
        <h1>Não foi possível carregar esta unidade.</h1>
        <p className="public-state-copy">
          Não exibimos dados fictícios no lugar de um cardápio real. Confira o QR Code ou tente
          novamente em instantes.
        </p>
        <a className="public-state-action" href={`/m/${encodeURIComponent(slug)}`}>
          Tentar novamente
        </a>
        <a className="public-state-secondary" href="/privacidade">
          Ver privacidade
        </a>
      </main>
    );
  }
  return <MenuExperience initialItems={menu.items} menuSlug={slug} branding={menu.branding} />;
}
