import { Button } from "@giromesa/ui";
import Image from "next/image";

type HubState = "checking" | "online" | "offline";

export function MenuHeader({
  hub,
  branding,
  open,
  tableAuthorized,
  tableLabel,
  onInfo,
}: {
  hub: HubState;
  branding?: PublicMenuBranding;
  open?: boolean;
  tableAuthorized: boolean;
  tableLabel?: string;
  onInfo: () => void;
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
          <span>{branding?.slogan ?? "Consulte os dados informados pela equipe"}</span>
          {open !== undefined && (
            <strong className={`business-status ${open ? "open" : "closed"}`}>
              {open ? "Aberto agora" : "Fechado agora"}
            </strong>
          )}
          {branding?.openingHours && (
            <small className="business-hours">{branding.openingHours}</small>
          )}
        </div>
        <Button
          type="button"
          className="icon-button"
          aria-label="Ver informações do restaurante"
          onClick={onInfo}
        >
          i
        </Button>
      </header>

      <div className={`connection-banner ${hub}`} role="status">
        <span aria-hidden="true">{hub === "online" ? "●" : hub === "checking" ? "◌" : "!"}</span>
        <div>
          <strong>
            {hub === "online" && tableAuthorized
              ? `${tableLabel ?? "Mesa"} verificada`
              : hub === "checking"
                ? "Confirmando atendimento…"
                : tableAuthorized
                  ? "Chamados da mesa temporariamente pausados"
                  : "Cardápio aberto sem identificação da mesa"}
          </strong>
          <small>
            {hub === "online" && tableAuthorized
              ? "A operação está confirmando chamados e pedidos de conta."
              : tableAuthorized
                ? "O cardápio e o checkout público continuam disponíveis quando habilitados."
                : "Leia o QR da mesa para chamar a equipe; retirada e delivery continuam disponíveis."}
          </small>
        </div>
      </div>
      {(branding?.notice || branding?.address || branding?.phone || branding?.instagram) && (
        <section className="brand-details" aria-label="Informações do estabelecimento">
          {branding.notice && <p className="brand-notice">{branding.notice}</p>}
          <div>
            {branding.address && <span>{branding.address}</span>}
            {branding.phone && <span>Telefone: {branding.phone}</span>}
            {branding.instagram && <span>Instagram: {branding.instagram}</span>}
          </div>
        </section>
      )}
    </>
  );
}

import type { PublicMenuBranding } from "../../lib/api";
