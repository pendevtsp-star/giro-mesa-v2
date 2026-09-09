import { Badge, Card, EmptyState, Icon } from "@giromesa/ui";
import { api } from "../../api";
import type { RouteId } from "../../domain";
import {
  dateTime,
  type GrowthScope,
  type MultiunitSummary,
  parseMultiunitSummary,
  RemoteGate,
  useRemote,
} from "../../growth.shared";
import { routeHref } from "../../router";
import { formatMoney } from "../../rules";
import "./multiunit.css";

type UnitSummary = MultiunitSummary["units"][number];

export function multiunitAttention(unit: UnitSummary) {
  return (unit.delays.total ?? 0) + (unit.stockouts.total ?? 0);
}

export function scopedUnitHref(
  currentUrl: string,
  organizationId: string,
  unitId: string,
  route: RouteId,
) {
  const url = new URL(currentUrl);
  url.search = "";
  url.searchParams.set("reportOrganization", organizationId);
  url.searchParams.set("reportUnit", unitId);
  url.hash = routeHref(route);
  return `${url.pathname}${url.search}${url.hash}`;
}

function operationalTone(value: number | null): "neutral" | "success" | "warning" | "danger" {
  if (value === null) return "neutral";
  if (value === 0) return "success";
  return value > 2 ? "danger" : "warning";
}

export function RealMultiunitPage({ scope }: { scope: GrowthScope }) {
  const remote = useRemote(
    scope,
    () => api.growth.multiunitSummary(scope.organizationId),
    parseMultiunitSummary,
  );
  return (
    <RemoteGate remote={remote}>
      {(summary) => (
        <div className="growth-stack">
          <Card className="honest-limit">
            <Badge tone="info">Consolidado persistido</Badge>
            <h2>Visão da organização</h2>
            <p>{summary.disclaimer}</p>
            <small>Gerado em {dateTime(summary.generatedAt)}</small>
          </Card>
          {summary.units.length === 0 ? (
            <EmptyState
              icon={<Icon name="multiunit" size={28} />}
              title="Sem unidades ativas"
              description="Nenhuma unidade foi retornada no consolidado."
            />
          ) : (
            <div className="multiunit-grid">
              {[...summary.units]
                .sort(
                  (left, right) =>
                    multiunitAttention(right) - multiunitAttention(left) ||
                    left.name.localeCompare(right.name, "pt-BR", { numeric: true }),
                )
                .map((unit) => {
                  const href = (route: RouteId) =>
                    scopedUnitHref(window.location.href, scope.organizationId, unit.id, route);
                  return (
                    <Card className="multiunit-card" key={unit.id}>
                      <header>
                        <div>
                          <p className="eyebrow">Unidade</p>
                          <h2>{unit.name}</h2>
                        </div>
                        {multiunitAttention(unit) > 0 ? (
                          <Badge tone={multiunitAttention(unit) > 2 ? "danger" : "warning"}>
                            {multiunitAttention(unit)} alerta(s)
                          </Badge>
                        ) : (
                          <Badge tone="success">Sem alertas cobertos</Badge>
                        )}
                      </header>
                      <div className="multiunit-operational-grid">
                        <a href={href("cash")}>
                          <span>Caixa</span>
                          <strong>
                            {unit.cash.status === "open"
                              ? "Aberto"
                              : unit.cash.status === "closed"
                                ? "Fechado"
                                : "Sem caixa configurado"}
                          </strong>
                          <small>
                            {unit.cash.openSince
                              ? `Desde ${dateTime(unit.cash.openSince)}`
                              : unit.cash.varianceCents !== null
                                ? `Última diferença ${formatMoney(unit.cash.varianceCents)}`
                                : "Abrir Contas e caixa"}
                          </small>
                        </a>
                        <a href={href("kds")}>
                          <span>Atrasos de produção</span>
                          <strong>
                            {unit.delays.total === null
                              ? "Sem cobertura KDS"
                              : unit.delays.total === 0
                                ? "No prazo"
                                : `${unit.delays.total} pedido(s)`}
                          </strong>
                          <Badge tone={operationalTone(unit.delays.total)}>
                            {unit.delays.oldestMinutes === null
                              ? "Sem atraso medido"
                              : `Mais antigo: ${unit.delays.oldestMinutes} min`}
                          </Badge>
                        </a>
                        <a href={href("kds")}>
                          <span>Rupturas do cardápio</span>
                          <strong>
                            {unit.stockouts.total === null
                              ? "Sem disponibilidade configurada"
                              : unit.stockouts.total === 0
                                ? "Nenhuma"
                                : `${unit.stockouts.total} produto(s)`}
                          </strong>
                          <Badge tone={operationalTone(unit.stockouts.total)}>
                            Abrir disponibilidade
                          </Badge>
                        </a>
                      </div>
                      <dl className="definition-grid">
                        <div>
                          <dt>Delivery concluído</dt>
                          <dd>{formatMoney(unit.completedDeliveryGrossCents)}</dd>
                        </div>
                        <div>
                          <dt>Reservas ativas</dt>
                          <dd>{unit.activeReservations}</dd>
                        </div>
                        <div>
                          <dt>Fila ativa</dt>
                          <dd>{unit.activeWaitlist}</dd>
                        </div>
                      </dl>
                      <a className="multiunit-report-link" href={href("reports")}>
                        Abrir relatório desta unidade →
                      </a>
                    </Card>
                  );
                })}
            </div>
          )}
          <Card>
            <h2>Transferências de estoque</h2>
            {Object.keys(summary.transfersByStatus).length === 0 ? (
              <p className="muted">Nenhuma transferência persistida.</p>
            ) : (
              <div className="badge-row">
                {Object.entries(summary.transfersByStatus).map(([status, total]) => (
                  <Badge key={status} tone="neutral">
                    {status}: {total}
                  </Badge>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </RemoteGate>
  );
}
