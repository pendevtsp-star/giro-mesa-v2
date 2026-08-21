import {
  Button,
  Callout,
  Card,
  DataTable,
  EmptyState,
  Input,
  Modal,
  NativeSelect,
} from "@giromesa/ui";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import {
  dateLabel,
  type ManagementScope,
  type ReportComparisonMode,
  type ReportData,
} from "../../management.shared";
import { formatMoney } from "../../rules";
import "./report-enhancements.css";

export type EnhancedReportFamily = "labor" | "reconciliation" | "forecast";
export type ReportViewFamily =
  | "overview"
  | "sales"
  | "exceptions"
  | "inventory"
  | "purchasing"
  | "operations"
  | "profitability"
  | "multiunit"
  | "quality"
  | EnhancedReportFamily;

interface ReportViewQuery {
  from: string;
  to: string;
  comparisonMode: ReportComparisonMode;
  family: ReportViewFamily;
}

interface ReportView {
  id: string;
  name: string;
  visibility: "private" | "unit" | "organization";
  query: ReportViewQuery;
  version: number;
}

interface ReportAlert {
  id: string;
  title: string;
  detail: string;
  severity: "info" | "warning" | "critical";
  status: "open" | "claimed" | "resolved" | "dismissed";
  actualCents: number | null;
  targetCents: number | null;
  dueAt: string | null;
  version: number;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseViews(value: unknown): ReportView[] {
  const entries = record(value).views;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((candidate) => {
    const row = record(candidate);
    const query = record(row.query);
    const family = typeof query.family === "string" ? query.family : "overview";
    if (
      typeof row.id !== "string" ||
      typeof row.name !== "string" ||
      typeof query.from !== "string" ||
      typeof query.to !== "string" ||
      !["private", "unit", "organization"].includes(String(row.visibility)) ||
      !["previous_period", "previous_year", "none"].includes(String(query.comparisonMode)) ||
      ![
        "overview",
        "sales",
        "exceptions",
        "inventory",
        "purchasing",
        "operations",
        "profitability",
        "multiunit",
        "quality",
        "labor",
        "reconciliation",
        "forecast",
      ].includes(family)
    )
      return [];
    return [
      {
        id: row.id,
        name: row.name,
        visibility: row.visibility as ReportView["visibility"],
        query: {
          from: query.from,
          to: query.to,
          comparisonMode: query.comparisonMode as ReportComparisonMode,
          family: family as ReportViewFamily,
        },
        version: Number.isInteger(row.version) ? Number(row.version) : 1,
      },
    ];
  });
}

function parseAlerts(value: unknown): ReportAlert[] {
  const entries = record(value).alerts;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((candidate) => {
    const row = record(candidate);
    if (typeof row.id !== "string" || typeof row.title !== "string") return [];
    return [
      {
        id: row.id,
        title: row.title,
        detail: typeof row.detail === "string" ? row.detail : "",
        severity:
          row.severity === "critical"
            ? "critical"
            : row.severity === "warning"
              ? "warning"
              : "info",
        status:
          row.status === "claimed" || row.status === "resolved" || row.status === "dismissed"
            ? row.status
            : "open",
        actualCents: typeof row.actualCents === "number" ? row.actualCents : null,
        targetCents: typeof row.targetCents === "number" ? row.targetCents : null,
        dueAt: typeof row.dueAt === "string" ? row.dueAt : null,
        version: Number.isInteger(row.version) ? Number(row.version) : 1,
      },
    ];
  });
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Não foi possível concluir a ação.";
}

function minutes(value: number): string {
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return hours ? `${hours}h ${rest ? `${rest}min` : ""}`.trim() : `${rest}min`;
}

function percent(value: number | null): string {
  return value === null
    ? "Indisponível"
    : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value)}%`;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <Card className="metric-card">
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{note}</small>
    </Card>
  );
}

export function EnhancedReportFamilyView({
  data,
  family,
}: {
  data: ReportData;
  family: EnhancedReportFamily;
}) {
  if (family === "labor") {
    const labor = data.reportFamilies.labor;
    return (
      <div className="reports-family-view">
        <header className="reports-section-heading">
          <div>
            <p className="eyebrow">Pessoas e escala</p>
            <h2>Mão de obra</h2>
            <p>Horas trabalhadas, escala, horas extras e produtividade sobre a receita.</p>
          </div>
        </header>
        {labor.coverage !== "complete" && (
          <Callout tone="warning">
            <strong>Cobertura parcial</strong>
            <span>
              Complete jornadas, escalas e custos para comparar produtividade sem distorção.
            </span>
          </Callout>
        )}
        <div className="metrics-grid reports-metrics">
          <Metric
            label="Horas trabalhadas"
            value={minutes(labor.workedMinutes)}
            note={`${labor.people} pessoas`}
          />
          <Metric
            label="Horas extras"
            value={labor.overtimeMinutes === null ? "Indisponível" : minutes(labor.overtimeMinutes)}
            note="Acima da escala registrada"
          />
          <Metric
            label="Custo de mão de obra"
            value={
              labor.laborCostCents === null ? "Indisponível" : formatMoney(labor.laborCostCents)
            }
            note={`${percent(labor.laborCostPercent)} da receita`}
          />
          <Metric
            label="Receita por hora"
            value={
              labor.salesPerLaborHourCents === null
                ? "Indisponível"
                : formatMoney(labor.salesPerLaborHourCents)
            }
            note="Receita por hora trabalhada"
          />
        </div>
        <Card className="reports-section-card">
          {labor.roles.length ? (
            <DataTable caption="Jornada e custo por função">
              <thead>
                <tr>
                  <th>Função</th>
                  <th>Pessoas</th>
                  <th>Trabalhado</th>
                  <th>Escalado</th>
                  <th>Extra</th>
                  <th>Custo</th>
                </tr>
              </thead>
              <tbody>
                {labor.roles.map((role) => (
                  <tr key={role.roleLabel}>
                    <th scope="row">{role.roleLabel}</th>
                    <td>{role.people}</td>
                    <td>{minutes(role.workedMinutes)}</td>
                    <td>{minutes(role.scheduledMinutes)}</td>
                    <td>{minutes(role.overtimeMinutes)}</td>
                    <td>
                      {role.laborCostCents === null
                        ? "Indisponível"
                        : formatMoney(role.laborCostCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <EmptyState
              icon="◇"
              title="Sem jornadas no período"
              description="Os indicadores aparecerão após o registro de ponto ou escala."
            />
          )}
        </Card>
      </div>
    );
  }

  if (family === "reconciliation") {
    const reconciliation = data.reportFamilies.reconciliation;
    return (
      <div className="reports-family-view">
        <header className="reports-section-heading">
          <div>
            <p className="eyebrow">Conferência</p>
            <h2>Fiscal e pagamentos</h2>
            <p>Compara venda POS, pagamentos, documentos fiscais e conciliação externa.</p>
          </div>
        </header>
        {(reconciliation.paymentDifferenceCents !== 0 ||
          reconciliation.fiscalDifferenceCents !== 0) && (
          <Callout tone="warning">
            <strong>Divergências exigem revisão</strong>
            <span>
              Abra os detalhes antes do fechamento: diferença não é tratada como receita ou perda.
            </span>
          </Callout>
        )}
        <div className="metrics-grid reports-metrics">
          <Metric
            label="Venda POS"
            value={formatMoney(reconciliation.posRevenueCents)}
            note="Contas fechadas"
          />
          <Metric
            label="Diferença em pagamentos"
            value={formatMoney(reconciliation.paymentDifferenceCents)}
            note={`${formatMoney(reconciliation.paymentCents)} identificados`}
          />
          <Metric
            label="Diferença fiscal"
            value={formatMoney(reconciliation.fiscalDifferenceCents)}
            note={`${formatMoney(reconciliation.fiscalAuthorizedCents)} autorizados`}
          />
          <Metric
            label="Tributos"
            value={formatMoney(reconciliation.taxCents)}
            note="Documentos fiscais do período"
          />
        </div>
        <Card className="reports-section-card">
          <DataTable caption="Conciliação fiscal e externa">
            <thead>
              <tr>
                <th>Fonte</th>
                <th>Confirmados</th>
                <th>Pendentes</th>
                <th>Divergentes</th>
                <th>Valor pendente/divergente</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Documentos fiscais</th>
                <td>{reconciliation.documents.authorized}</td>
                <td>{reconciliation.documents.rejected}</td>
                <td>{reconciliation.documents.canceled}</td>
                <td>{formatMoney(reconciliation.fiscalDifferenceCents)}</td>
              </tr>
              <tr>
                <th scope="row">Conciliação externa</th>
                <td>{reconciliation.external.matched}</td>
                <td>{reconciliation.external.unmatched}</td>
                <td>{reconciliation.external.divergent}</td>
                <td>
                  {formatMoney(
                    reconciliation.external.unmatchedCents + reconciliation.external.divergentCents,
                  )}
                </td>
              </tr>
            </tbody>
          </DataTable>
        </Card>
      </div>
    );
  }

  const forecast = data.reportFamilies.forecast;
  return (
    <div className="reports-family-view">
      <header className="reports-section-heading">
        <div>
          <p className="eyebrow">Projeção</p>
          <h2>Previsão operacional</h2>
          <p>Média histórica transparente, com intervalo e erro; não substitui uma meta.</p>
        </div>
      </header>
      <Callout tone={forecast.confidence === "low" ? "warning" : "info"}>
        <strong>
          Confiança{" "}
          {forecast.confidence === "high"
            ? "alta"
            : forecast.confidence === "medium"
              ? "média"
              : "baixa"}
        </strong>
        <span>
          Amostra de {forecast.sampleDays} dias
          {forecast.errorPercent === null
            ? "."
            : `; erro observado de ${percent(forecast.errorPercent)}.`}
        </span>
      </Callout>
      <div className="metrics-grid reports-metrics">
        <Metric
          label={`Receita em ${forecast.horizonDays} dias`}
          value={formatMoney(forecast.revenue.forecastCents)}
          note={`${formatMoney(forecast.revenue.lowerBoundCents)} a ${formatMoney(forecast.revenue.upperBoundCents)}`}
        />
        <Metric
          label="Média diária"
          value={formatMoney(forecast.revenue.dailyAverageCents)}
          note="Histórico do período"
        />
        <Metric
          label="Entradas projetadas"
          value={formatMoney(forecast.cash.inflowsCents)}
          note="Projeção, não realização"
        />
        <Metric
          label="Saldo projetado"
          value={formatMoney(forecast.cash.netCents)}
          note={`${formatMoney(forecast.cash.outflowsCents)} em saídas`}
        />
      </div>
      <Card className="reports-section-card">
        {forecast.purchases.length ? (
          <DataTable caption="Sugestão de compra baseada no consumo">
            <thead>
              <tr>
                <th>Insumo</th>
                <th>Demanda diária</th>
                <th>Quantidade sugerida</th>
              </tr>
            </thead>
            <tbody>
              {forecast.purchases.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  <td>{row.dailyDemand.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}</td>
                  <td>
                    {row.suggestedQuantity.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          <EmptyState
            icon="◇"
            title="Sem sugestão de compra"
            description="Não há demanda ou estoque suficientes para uma recomendação segura."
          />
        )}
      </Card>
    </div>
  );
}

export function ReportViewManager({
  scope,
  query,
  onApply,
}: {
  scope: ManagementScope;
  query: ReportViewQuery;
  onApply: (query: ReportViewQuery) => void;
}) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<ReportView[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<ReportView["visibility"]>("private");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const selected = useMemo(() => views.find((view) => view.id === selectedId), [selectedId, views]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const parsed = parseViews(
        await api.management.reportViews(scope.organizationId, scope.unitId),
      );
      setViews(parsed);
      setSelectedId((current) =>
        parsed.some((view) => view.id === current) ? current : (parsed[0]?.id ?? ""),
      );
    } catch (cause) {
      setStatus(message(cause));
    } finally {
      setBusy(false);
    }
  }, [scope.organizationId, scope.unitId]);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      await api.management.createReportView(scope.organizationId, scope.unitId, {
        name,
        visibility,
        query,
      });
      setName("");
      setStatus("Visão salva no servidor.");
      await load();
    } catch (cause) {
      setStatus(message(cause));
      setBusy(false);
    }
  }

  async function remove() {
    if (!selected) return;
    setBusy(true);
    try {
      await api.management.deleteReportView(
        scope.organizationId,
        scope.unitId,
        selected.id,
        selected.version,
      );
      setStatus("Visão removida.");
      await load();
    } catch (cause) {
      setStatus(message(cause));
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" variant="ghost">
        Visões compartilhadas
      </Button>
      <Modal isOpen={open} onClose={() => setOpen(false)} size="lg" title="Visões salvas">
        <div className="reports-enhancement-stack">
          <section className="reports-view-picker">
            <label className="gm-field" htmlFor="reports-view-select">
              Visão disponível
              <NativeSelect
                id="reports-view-select"
                value={selectedId}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                <option value="">Selecione</option>
                {views.map((view) => (
                  <option key={view.id} value={view.id}>
                    {view.name} ·{" "}
                    {view.visibility === "private"
                      ? "privada"
                      : view.visibility === "unit"
                        ? "unidade"
                        : "organização"}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <div className="gm-toolbar">
              <Button
                disabled={!selected || busy}
                onClick={() => selected && onApply(selected.query)}
                size="sm"
              >
                Aplicar
              </Button>
              <Button
                disabled={!selected || busy}
                onClick={() => void remove()}
                size="sm"
                variant="ghost"
              >
                Excluir
              </Button>
            </div>
          </section>
          <form className="reports-enhancement-form" onSubmit={save}>
            <h3>Salvar a análise atual</h3>
            <label className="gm-field" htmlFor="reports-view-name">
              Nome
              <Input
                id="reports-view-name"
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </label>
            <label className="gm-field" htmlFor="reports-view-visibility">
              Compartilhamento
              <NativeSelect
                id="reports-view-visibility"
                onChange={(event) => setVisibility(event.target.value as ReportView["visibility"])}
                value={visibility}
              >
                <option value="private">Somente eu</option>
                {scope.profileId === "owner" ||
                scope.profileId === "manager" ||
                scope.profileId === "finance" ? (
                  <>
                    <option value="unit">Unidade</option>
                    <option value="organization">Organização</option>
                  </>
                ) : null}
              </NativeSelect>
            </label>
            <Button disabled={busy} size="sm" type="submit">
              Salvar visão
            </Button>
          </form>
          {!views.length && !busy && (
            <EmptyState
              icon="◇"
              title="Sem visões compartilhadas"
              description="Salve o período, a comparação e o relatório atual para reutilizar em outros dispositivos."
            />
          )}
          <span aria-live="polite">{status}</span>
        </div>
      </Modal>
    </>
  );
}

export function ReportActionCenter({ data, scope }: { data: ReportData; scope: ManagementScope }) {
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<ReportAlert[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    try {
      setAlerts(parseAlerts(await api.management.reportAlerts(scope.organizationId, scope.unitId)));
    } catch (cause) {
      setStatus(message(cause));
    } finally {
      setBusy(false);
    }
  }, [scope.organizationId, scope.unitId]);
  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  async function evaluate() {
    setBusy(true);
    try {
      await api.management.evaluateReportAlerts(scope.organizationId, scope.unitId, {
        ...data.period,
        comparisonMode: data.comparison?.mode ?? "previous_period",
      });
      setStatus("Indicadores avaliados sem duplicar ocorrências existentes.");
      await load();
    } catch (cause) {
      setStatus(message(cause));
      setBusy(false);
    }
  }

  async function update(alert: ReportAlert, next: "claimed" | "resolved" | "dismissed") {
    setBusy(true);
    try {
      await api.management.updateReportAlert(scope.organizationId, scope.unitId, alert.id, {
        status: next,
        version: alert.version,
      });
      await load();
    } catch (cause) {
      setStatus(message(cause));
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" variant="ghost">
        Central de ações
      </Button>
      <Modal isOpen={open} onClose={() => setOpen(false)} size="lg" title="Ações dos relatórios">
        <div className="reports-enhancement-stack">
          {data.capabilities.manageAlerts && (
            <Button disabled={busy} onClick={() => void evaluate()} size="sm" variant="secondary">
              Avaliar período atual
            </Button>
          )}
          {alerts.length ? (
            <DataTable caption="Alertas abertos dos relatórios">
              <thead>
                <tr>
                  <th>Alerta</th>
                  <th>Prazo</th>
                  <th>Estado</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert) => (
                  <tr key={alert.id}>
                    <th scope="row">
                      <span className="reports-alert-title" data-severity={alert.severity}>
                        {alert.title}
                      </span>
                      <small>{alert.detail}</small>
                    </th>
                    <td>{alert.dueAt ? dateLabel(alert.dueAt.slice(0, 10)) : "Sem prazo"}</td>
                    <td>{alert.status === "claimed" ? "Em tratamento" : "Aberto"}</td>
                    <td>
                      <div className="gm-toolbar">
                        {alert.status === "open" && (
                          <Button
                            disabled={busy}
                            onClick={() => void update(alert, "claimed")}
                            size="sm"
                            variant="ghost"
                          >
                            Assumir
                          </Button>
                        )}
                        <Button
                          disabled={busy}
                          onClick={() => void update(alert, "resolved")}
                          size="sm"
                        >
                          Resolver
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={() => void update(alert, "dismissed")}
                          size="sm"
                          variant="ghost"
                        >
                          Descartar
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : !busy ? (
            <EmptyState
              icon="✓"
              title="Nenhuma ação pendente"
              description="Avalie o período para transformar divergências e metas em tarefas acompanháveis."
            />
          ) : null}
          {busy && <p role="status">Atualizando ações…</p>}
          <span aria-live="polite">{status}</span>
        </div>
      </Modal>
    </>
  );
}

export function ReportCostBackfill({
  data,
  onRefresh,
  scope,
}: {
  data: ReportData;
  onRefresh?: () => void;
  scope: ManagementScope;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  async function run() {
    setBusy(true);
    setStatus("");
    try {
      const result = record(
        await api.management.backfillReportCosts(scope.organizationId, scope.unitId, {
          ...data.period,
          comparisonMode: data.comparison?.mode ?? "previous_period",
          allowEstimated: true,
        }),
      );
      setStatus(
        `${Number(result.estimatedCount ?? 0)} item(ns) receberam custo estimado; ${Number(result.unavailableCount ?? 0)} continuam sem custo.`,
      );
      setConfirmed(false);
      if (onRefresh) globalThis.setTimeout(onRefresh, 1_200);
    } catch (cause) {
      setStatus(message(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="reports-section-card reports-cost-backfill">
      <div className="reports-section-heading">
        <div>
          <p className="eyebrow">Histórico de custos</p>
          <h2>Completar itens sem custo</h2>
          <p>
            Usa o custo atual do catálogo e registra a origem como estimativa auditada. Valores
            exatos nunca são substituídos.
          </p>
        </div>
      </div>
      <label className="reports-checkbox">
        <input
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          type="checkbox"
        />
        Entendo que custos históricos ausentes serão estimados pelo cadastro atual.
      </label>
      <div className="gm-toolbar">
        <Button disabled={!confirmed || busy} onClick={() => void run()} size="sm">
          {busy ? "Processando…" : "Recompor custos estimados"}
        </Button>
        <span aria-live="polite">{status}</span>
      </div>
    </Card>
  );
}
