import { shiftHandoverResponseSchema } from "@giromesa/contracts";
import { Badge, Button, Card } from "@giromesa/ui";
import { useCallback, useRef, useState } from "react";
import { api } from "../../api";
import { type ManagementScope, RemoteGate, useRemote } from "../../management.shared";

const parseHandover = (value: unknown) => shiftHandoverResponseSchema.parse(value);

export function ShiftHandoverPanel({ scope }: { scope: ManagementScope }) {
  const { organizationId, unitId } = scope;
  const loader = useCallback(
    () => api.pilot.shiftHandover(organizationId, unitId),
    [organizationId, unitId],
  );
  const remote = useRemote(scope, loader, parseHandover);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ handoverId: string; key: string } | null>(null);
  async function acknowledge(handoverId: string) {
    if (!attempt.current || attempt.current.handoverId !== handoverId)
      attempt.current = { handoverId, key: crypto.randomUUID() };
    setBusy(true);
    setError(null);
    try {
      await api.pilot.acknowledgeShiftHandover(
        organizationId,
        unitId,
        handoverId,
        attempt.current.key,
      );
      remote.retry();
    } catch {
      setError(
        "Não foi possível confirmar a ciência. Tente novamente; a mesma confirmação será recuperada.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="dashboard-pulse">
      <details>
        <summary>Pré-fechamento e passagem de turno</summary>
        <RemoteGate remote={remote}>
          {({ current, lastHandover }) => (
            <>
              <p>Pendências atuais da unidade. Revise antes de encerrar ou passar o turno.</p>
              <div className="dashboard-pulse__grid">
                <a href="#/counter">
                  <span>Contas abertas</span>
                  <strong>{current.tabs.length}</strong>
                </a>
                <a href="#/kds">
                  <span>Pedidos não servidos</span>
                  <strong>{current.orders.length}</strong>
                </a>
                <a href="#/salon">
                  <span>Chamados em aberto</span>
                  <strong>{current.calls.length}</strong>
                </a>
                <a href="#/counter">
                  <span>Impressões a conferir</span>
                  <strong>{current.prints.length}</strong>
                </a>
                <a href="#/cash">
                  <span>Divergências de caixa</span>
                  <strong>{current.cash.length}</strong>
                </a>
              </div>
              <Button variant="secondary" onClick={() => remote.retry()}>
                Atualizar pendências
              </Button>
              {lastHandover ? (
                <section>
                  <h3>Última passagem</h3>
                  <p>
                    Encerrada por {lastHandover.closedBy ?? "responsável registrado"} em{" "}
                    {new Date(lastHandover.closedAt).toLocaleString("pt-BR")}.
                  </p>
                  <p>
                    No encerramento: {lastHandover.snapshot.tabs.length} conta(s),{" "}
                    {lastHandover.snapshot.orders.length} pedido(s),{" "}
                    {lastHandover.snapshot.calls.length} chamado(s),{" "}
                    {lastHandover.snapshot.prints.length} impressão(ões) e{" "}
                    {lastHandover.snapshot.cash.length} divergência(s) de caixa.
                  </p>
                  <details>
                    <summary>Conferir pendências registradas</summary>
                    <ul>
                      {lastHandover.snapshot.tabs.map((tab) => (
                        <li key={tab.id}>
                          <a href={`#/counter?tab=${encodeURIComponent(tab.id)}`}>
                            Comanda {tab.number ?? tab.id.slice(0, 8)}
                          </a>
                        </li>
                      ))}
                      {lastHandover.snapshot.calls.map((call) => (
                        <li key={call.id}>
                          <a href={`#/salon?table=${encodeURIComponent(call.tableId)}`}>
                            Chamado da mesa
                          </a>
                        </li>
                      ))}
                      {lastHandover.snapshot.orders.map((order) => (
                        <li key={order.id}>
                          <a href={`#/counter?tab=${encodeURIComponent(order.tabId)}`}>
                            Pedido {order.id.slice(0, 8)}
                          </a>
                        </li>
                      ))}
                      {lastHandover.snapshot.prints.map((print) => (
                        <li key={print.id}>
                          <a
                            href={
                              print.tabId
                                ? `#/counter?tab=${encodeURIComponent(print.tabId)}`
                                : "#/counter"
                            }
                          >
                            Impressão {print.id.slice(0, 8)} a conferir
                          </a>
                        </li>
                      ))}
                      {lastHandover.snapshot.cash.map((cash) => (
                        <li key={cash.id}>
                          <a href="#/cash">Divergência no fechamento {cash.id.slice(0, 8)}</a>
                        </li>
                      ))}
                    </ul>
                  </details>
                  {lastHandover.receipt && (
                    <Badge tone="success">
                      Ciência de {lastHandover.receipt.acknowledgedBy ?? "gestor"} em{" "}
                      {new Date(lastHandover.receipt.acknowledgedAt).toLocaleString("pt-BR")}
                    </Badge>
                  )}
                  <p>
                    Ao confirmar, você registra que conferiu esta passagem. A responsabilidade
                    financeira permanece nos lançamentos originais.
                  </p>
                  <Button disabled={busy} onClick={() => void acknowledge(lastHandover.id)}>
                    {busy ? "Registrando…" : "Confirmar minha ciência"}
                  </Button>
                </section>
              ) : (
                <p>
                  O próximo encerramento registrará um resumo de pendências para a gestão que
                  entrar.
                </p>
              )}
              {error && <p role="alert">{error}</p>}
            </>
          )}
        </RemoteGate>
      </details>
    </Card>
  );
}
