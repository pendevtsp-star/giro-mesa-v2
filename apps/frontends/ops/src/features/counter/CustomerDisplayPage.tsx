import { Badge, Button, Card, Separator } from "@giromesa/ui";
import { useEffect, useState } from "react";
import { api } from "../../api";
import { parseTabDetail, summarizeTabPayments, type TabDetail } from "../../operations.shared";
import { formatMoney } from "../../rules";
import "./customer-display.css";

export function customerDisplayTabIdFromHash(hash: string): string | null {
  const query = hash.split("?", 2)[1];
  return query ? new URLSearchParams(query).get("display") : null;
}

const statusLabels: Record<string, string> = {
  canceled: "Cancelado",
  draft: "Aguardando envio",
  preparing: "Em preparo",
  ready: "Pronto",
  sent: "Enviado",
  served: "Entregue",
};

export function CustomerDisplayPage({
  organizationId,
  unitId,
  unitName,
  tabId,
  refreshToken,
}: {
  organizationId: string;
  unitId: string;
  unitName: string;
  tabId: string;
  refreshToken: number;
}) {
  const [detail, setDetail] = useState<TabDetail | null>(null);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    void refreshToken;
    let active = true;
    void api.pilot
      .tab(organizationId, unitId, tabId)
      .then(parseTabDetail)
      .then((value) => {
        if (!active) return;
        setDetail(value);
        setError("");
        setUpdatedAt(new Date());
      })
      .catch(() => {
        if (active) setError("Não foi possível atualizar esta conta.");
      });
    return () => {
      active = false;
    };
  }, [organizationId, refreshToken, tabId, unitId]);

  const activeItems = detail?.items.filter((item) => item.status !== "canceled") ?? [];
  const paymentSummary = summarizeTabPayments(detail?.payments ?? []);
  const paidCents = paymentSummary.paidCents;
  const totalCents = detail?.tab.totalCents ?? 0;
  const balanceCents = Math.max(0, totalCents - paidCents);

  return (
    <main className="customer-display" id="main-content">
      <header className="customer-display__header">
        <div>
          <p>{unitName}</p>
          <h1>{detail?.tab.label ?? detail?.tab.customerName ?? "Seu atendimento"}</h1>
        </div>
        <div className="customer-display__controls">
          <Badge tone={error ? "warning" : "success"}>
            {error ? "Sem atualização" : "Ao vivo"}
          </Badge>
          <Button
            onClick={() => void document.documentElement.requestFullscreen?.()}
            size="sm"
            variant="ghost"
          >
            Tela cheia
          </Button>
        </div>
      </header>

      <section aria-busy={!detail && !error} className="customer-display__content">
        {!detail && !error && <p role="status">Carregando a conta…</p>}
        {!detail && error && <p role="alert">{error}</p>}
        {detail && (
          <>
            <Card className="customer-display__items">
              <div className="customer-display__section-title">
                <h2>Seu pedido</h2>
                <span>{activeItems.length} item(ns)</span>
              </div>
              <Separator />
              {activeItems.length === 0 ? (
                <p className="customer-display__empty">
                  Os itens aparecerão aqui após o lançamento.
                </p>
              ) : (
                <div className="customer-display__list">
                  {activeItems.map((item) => (
                    <article key={item.id}>
                      <span className="customer-display__quantity">{item.quantity}×</span>
                      <span>
                        <strong>{item.productName}</strong>
                        <small>{statusLabels[item.orderStatus ?? item.status] ?? "Lançado"}</small>
                      </span>
                      <strong>{formatMoney(item.netCents)}</strong>
                    </article>
                  ))}
                </div>
              )}
            </Card>

            <Card className="customer-display__totals">
              <span>
                <small>Total</small>
                <strong>{formatMoney(totalCents)}</strong>
              </span>
              <span>
                <small>Pago líquido</small>
                <strong>{formatMoney(paidCents)}</strong>
              </span>
              {paymentSummary.reversedCents > 0 && (
                <span>
                  <small>Estornado</small>
                  <strong>{formatMoney(paymentSummary.reversedCents)}</strong>
                </span>
              )}
              <Separator />
              <span className="customer-display__balance">
                <small>Saldo</small>
                <strong>{formatMoney(balanceCents)}</strong>
              </span>
            </Card>
          </>
        )}
      </section>

      <footer className="customer-display__footer">
        <span>{error || "A conta acompanha os lançamentos e pagamentos em tempo real."}</span>
        {updatedAt && <span>Atualizado às {updatedAt.toLocaleTimeString("pt-BR")}</span>}
      </footer>
    </main>
  );
}
