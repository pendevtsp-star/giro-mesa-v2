import { Badge, Button } from "@giromesa/ui";
import type { RelatedServiceTab } from "../../operations.shared";
import { formatMoney } from "../../rules";

export function ServiceAccounts({
  accounts,
  selectedId,
  tableLabel,
  busy,
  canReceive,
  canPrint,
  onSelect,
  onPrint,
}: {
  accounts: RelatedServiceTab[];
  selectedId: string;
  tableLabel: string;
  busy: boolean;
  canReceive: boolean;
  canPrint: boolean;
  onSelect: (id: string, action: "order" | "account") => void;
  onPrint: (id: string) => void;
}) {
  if (accounts.length < 2) return null;
  const openAccounts = accounts.filter((account) => account.status === "open");
  return (
    <section aria-label="Comandas deste atendimento" className="service-accounts">
      <header>
        <div>
          <strong>
            {tableLabel} · {accounts.length} comandas
          </strong>
          <small>Todas permanecem neste atendimento até o encerramento.</small>
        </div>
        <span>
          <small>Saldo do atendimento</small>
          <strong>
            {formatMoney(openAccounts.reduce((sum, account) => sum + account.remainingCents, 0))}
          </strong>
        </span>
      </header>
      <div className="service-accounts__list">
        {accounts.map((account) => (
          <article key={account.id} data-selected={account.id === selectedId}>
            <button
              aria-current={account.id === selectedId ? "true" : undefined}
              className="service-accounts__select"
              disabled={busy}
              onClick={() => onSelect(account.id, "account")}
              type="button"
            >
              <strong>
                {account.label ?? (account.serviceRootTabId ? "Comanda separada" : "Principal")}
              </strong>
              <span>
                {account.status === "open" ? formatMoney(account.remainingCents) : "Encerrada"}
              </span>
              <small>
                {account.status === "open" ? "Saldo a receber" : "Consumo e pagamentos preservados"}
              </small>
            </button>
            <div className="service-accounts__actions">
              {account.status === "open" && account.remainingCents === 0 && (
                <Badge tone="success">Quitada</Badge>
              )}
              {canPrint && account.status === "open" && (
                <Button
                  aria-label={`Imprimir pré-conta de ${account.label ?? "Principal"}`}
                  disabled={busy}
                  onClick={() => onPrint(account.id)}
                  size="sm"
                  variant="ghost"
                >
                  Imprimir
                </Button>
              )}
              {canReceive && account.status === "open" && (
                <Button
                  aria-label={`${account.remainingCents > 0 ? "Receber" : "Finalizar"} ${account.label ?? "Principal"}`}
                  disabled={busy}
                  onClick={() => onSelect(account.id, "account")}
                  size="sm"
                  variant="secondary"
                >
                  {account.remainingCents > 0 ? "Receber" : "Finalizar"}
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
