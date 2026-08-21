import { Button } from "@giromesa/ui";

type HubState = "checking" | "online" | "offline";

export function MenuHeader({
  hub,
  branding,
  tableAuthorized,
  onInfo,
}: {
  hub: HubState;
  branding?: PublicMenuBranding;
  tableAuthorized: boolean;
  onInfo: () => void;
}) {
  return (
    <>
      <header className="restaurant-header">
        <div className="restaurant-mark" aria-hidden="true">
          {branding?.displayName[0] ?? "G"}
        </div>
        <div>
          <p>Cardápio digital</p>
          <h1>{branding?.displayName ?? "Cardápio da unidade"}</h1>
          <span>{branding?.slogan ?? "Consulte os dados informados pela equipe"}</span>
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
              ? "Atendimento da mesa disponível"
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
    </>
  );
}

import type { PublicMenuBranding } from "../../lib/api";
