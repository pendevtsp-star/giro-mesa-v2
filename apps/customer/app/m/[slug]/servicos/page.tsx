import { PublicServicesExperience } from "../../../../components/public-services-experience";
import { getPublicMenu } from "../../../../lib/api";

export default async function PublicServicesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const menu = await getPublicMenu(slug);
  if (menu.source === "unavailable") {
    return (
      <main className="public-state">
        <span className="public-state-mark" aria-hidden="true">
          !
        </span>
        <p className="public-state-eyebrow">Serviços indisponíveis</p>
        <h1>Não foi possível validar esta unidade.</h1>
        <p className="public-state-copy">
          Nenhuma solicitação foi enviada. Volte ao QR Code da unidade ou tente novamente.
        </p>
        <a className="public-state-action" href={`/m/${encodeURIComponent(slug)}/servicos`}>
          Tentar novamente
        </a>
      </main>
    );
  }
  return <PublicServicesExperience menuSlug={slug} demo={menu.source === "demo"} />;
}
