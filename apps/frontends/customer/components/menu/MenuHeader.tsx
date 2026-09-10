import Image from "next/image";
import type { PublicMenuBranding } from "../../lib/api";
import { ThemeSelector } from "./ThemeSelector";

type HubState = "checking" | "online" | "offline";

export function MenuHeader({
  hub,
  branding,
  open,
  tableAuthorized,
  tableLabel,
}: {
  hub: HubState;
  branding?: PublicMenuBranding;
  open?: boolean;
  tableAuthorized: boolean;
  tableLabel?: string;
}) {
  return (
    <>
      <header className={`restaurant-header${branding?.coverImageUrl ? " has-cover" : ""}`}>
        {branding?.coverImageUrl && (
          <Image
            alt=""
            aria-hidden="true"
            className="restaurant-header__cover"
            fill
            priority
            sizes="(max-width: 760px) 100vw, 760px"
            src={branding.coverImageUrl}
            unoptimized
          />
        )}
        <div className="restaurant-mark" aria-hidden="true">
          {branding?.logoUrl ? (
            <Image alt="" height={58} src={branding.logoUrl} unoptimized width={58} />
          ) : (
            (branding?.displayName[0] ?? "G")
          )}
        </div>
        <div className="restaurant-header__content">
          <p>Cardápio digital</p>
          <h1>{branding?.displayName ?? "Cardápio da unidade"}</h1>
          {branding?.slogan && <span>{branding.slogan}</span>}
          {open !== undefined && (
            <strong className={`business-status ${open ? "open" : "closed"}`}>
              {open ? "Aberto agora" : "Fechado agora"}
            </strong>
          )}
          {branding?.openingHours && (
            <details className="business-hours">
              <summary className="business-hours-summary">Ver horários</summary>
              <small className="business-hours-copy">{branding.openingHours}</small>
            </details>
          )}
        </div>
        <div className="restaurant-header__controls">
          <ThemeSelector />
        </div>
      </header>

      {tableAuthorized && (
        <div className={`connection-banner ${hub}`} role="status">
          <span aria-hidden="true">{hub === "online" ? "●" : "!"}</span>
          <div>
            <strong>
              {hub === "online"
                ? `${tableLabel ?? "Mesa"} verificada`
                : "Chamados da mesa temporariamente pausados"}
            </strong>
            <small>
              {hub === "online"
                ? "A operação está confirmando chamados e pedidos de conta."
                : "O cardápio e o checkout público continuam disponíveis quando habilitados."}
            </small>
          </div>
        </div>
      )}
      {(branding?.notice || branding?.address || branding?.phone || branding?.instagram) && (
        <details className="brand-details">
          <summary className="brand-details-summary">Informações da unidade</summary>
          {branding.notice && <p className="brand-notice">{branding.notice}</p>}
          <div>
            {branding.address && <span>{branding.address}</span>}
            {branding.phone && <span>Telefone: {branding.phone}</span>}
            {branding.instagram && <span>Instagram: {branding.instagram}</span>}
          </div>
        </details>
      )}
    </>
  );
}
