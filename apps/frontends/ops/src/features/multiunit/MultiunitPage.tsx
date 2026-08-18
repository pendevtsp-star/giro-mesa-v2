import { Badge, Card, EmptyState, Icon } from "@giromesa/ui";
import { api } from "../../api";
import {
  dateTime,
  type GrowthScope,
  parseMultiunitSummary,
  RemoteGate,
  useRemote,
} from "../../growth.shared";
import { formatMoney } from "../../rules";

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
            <div className="ops-grid">
              {summary.units.map((unit) => (
                <Card key={unit.id}>
                  <h2>{unit.name}</h2>
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
                </Card>
              ))}
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
