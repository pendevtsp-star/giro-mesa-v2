import {
  Button,
  Callout,
  Card,
  DataTable,
  EmptyState,
  Input,
  Modal,
  NativeSelect,
  Textarea,
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
  isDefault: boolean;
  sortOrder: number;
  version: number;
}

interface ReportAlertSource {
  period?: { from: string; to: string };
  family?: ReportViewFamily;
  route?: string;
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
  assignedToIdentityId: string | null;
  source: ReportAlertSource;
  history: Array<{
    action: string;
    status: ReportAlert["status"];
    comment: string | null;
    occurredAt: string;
  }>;
  version: number;
}

interface ReportCostPreview {
  candidateCount: number;
  estimatedCount: number;
  unavailableCount: number;
  estimatedTotalCents: number;
  coverageAfter: number | null;
}

interface ReconciliationClosure {
  status: "open" | "closed";
  closedAt: string | null;
  closedByIdentityId: string | null;
  note: string;
  evidence: string[];
  checklist: { payments: boolean; fiscal: boolean; external: boolean };
}

const reportFamilies: ReportViewFamily[] = [
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
];

function reportFamily(value: unknown): ReportViewFamily | undefined {
  return typeof value === "string" && reportFamilies.includes(value as ReportViewFamily)
    ? (value as ReportViewFamily)
    : undefined;
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
    const family = reportFamily(query.family) ?? "overview";
    if (
      typeof row.id !== "string" ||
      typeof row.name !== "string" ||
      typeof query.from !== "string" ||
      typeof query.to !== "string" ||
      !["private", "unit", "organization"].includes(String(row.visibility)) ||
      !["previous_period", "previous_year", "none"].includes(String(query.comparisonMode)) ||
      !reportFamilies.includes(family)
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
        isDefault: row.isDefault === true,
        sortOrder: Number.isInteger(row.sortOrder) ? Number(row.sortOrder) : 0,
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
    const rawSource = record(row.source);
    const rawPeriod = record(rawSource.period);
    const source: ReportAlertSource = {};
    if (typeof rawPeriod.from === "string" && typeof rawPeriod.to === "string") {
      source.period = { from: rawPeriod.from, to: rawPeriod.to };
    }
    const family = reportFamily(rawSource.family);
    if (family) source.family = family;
    if (typeof rawSource.route === "string") source.route = rawSource.route;
    const history = Array.isArray(row.history)
      ? row.history.flatMap((entry) => {
          const item = record(entry);
          if (typeof item.occurredAt !== "string" || typeof item.status !== "string") return [];
          const status: ReportAlert["status"] =
            item.status === "claimed" || item.status === "resolved" || item.status === "dismissed"
              ? item.status
              : "open";
          return [
            {
              action: typeof item.action === "string" ? item.action : "updated",
              status,
              comment: typeof item.comment === "string" ? item.comment : null,
              occurredAt: item.occurredAt,
            },
          ];
        })
      : [];
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
        assignedToIdentityId:
          typeof row.assignedToIdentityId === "string" ? row.assignedToIdentityId : null,
        source,
        history,
        version: Number.isInteger(row.version) ? Number(row.version) : 1,
      },
    ];
  });
}

function parseAlert(value: unknown): ReportAlert | null {
  return parseAlerts({ alerts: [value] })[0] ?? null;
}

function parseCostPreview(value: unknown): ReportCostPreview {
  const row = record(value);
  const values = [
    row.candidateCount,
    row.estimatedCount,
    row.unavailableCount,
    row.estimatedTotalCents,
  ].map(Number);
  const coverageAfter = row.coverageAfter === null ? null : Number(row.coverageAfter);
  if (
    values.some((item) => !Number.isFinite(item) || item < 0) ||
    (coverageAfter !== null &&
      (!Number.isFinite(coverageAfter) || coverageAfter < 0 || coverageAfter > 100))
  ) {
    throw new Error("A prévia de custos retornou valores inválidos.");
  }
  return {
    candidateCount: Math.trunc(values[0] ?? 0),
    estimatedCount: Math.trunc(values[1] ?? 0),
    unavailableCount: Math.trunc(values[2] ?? 0),
    estimatedTotalCents: Math.round(values[3] ?? 0),
    coverageAfter,
  };
}

function alertHref(route: string | undefined): string | null {
  const normalized = route?.trim().replace(/^#\/?/, "") ?? "";
  return /^[a-z][a-z0-9/-]*(?:\?[a-zA-Z0-9%&=_-]+)?$/.test(normalized) ? `#/${normalized}` : null;
}

function dueAt(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T23:59:59`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function localDateInput(value: string | Date): string {
  const parsed = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(parsed.getTime())) return "";
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function deferredDueAt(current: string | null): string {
  const base = current && new Date(current).getTime() > Date.now() ? new Date(current) : new Date();
  base.setDate(base.getDate() + 1);
  return base.toISOString();
}

function parseReconciliationClosure(value: unknown): ReconciliationClosure {
  const row = record(value);
  const checklist = record(row.checklist);
  return {
    status: row.status === "closed" ? "closed" : "open",
    closedAt: typeof row.closedAt === "string" ? row.closedAt : null,
    closedByIdentityId: typeof row.closedByIdentityId === "string" ? row.closedByIdentityId : null,
    note: typeof row.note === "string" ? row.note : "",
    evidence: Array.isArray(row.evidence)
      ? row.evidence.filter((item): item is string => typeof item === "string" && isHttpsUrl(item))
      : [],
    checklist: {
      payments: checklist.payments === true,
      fiscal: checklist.fiscal === true,
      external: checklist.external === true,
    },
  };
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

function ReportReconciliationClosure({
  closure: initialClosure,
  data,
  onRefresh,
  scope,
}: {
  closure: ReconciliationClosure;
  data: ReportData;
  onRefresh?: () => void;
  scope?: ManagementScope;
}) {
  const [checklist, setChecklist] = useState(initialClosure.checklist);
  const [note, setNote] = useState(initialClosure.note);
  const [evidence, setEvidence] = useState(initialClosure.evidence.join("\n"));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const canManage = scope && ["owner", "manager", "finance"].includes(scope.profileId);

  useEffect(() => {
    setChecklist(initialClosure.checklist);
    setNote(initialClosure.note);
    setEvidence(initialClosure.evidence.join("\n"));
  }, [initialClosure]);

  async function save(nextStatus: "open" | "closed") {
    if (!scope) return;
    const normalizedNote = note.trim();
    const normalizedEvidence = evidence
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (normalizedNote.length < 2) {
      setError("Registre uma observação com pelo menos 2 caracteres.");
      return;
    }
    if (normalizedEvidence.length > 10 || normalizedEvidence.some((item) => !isHttpsUrl(item))) {
      setError("Informe no máximo 10 evidências, uma URL HTTPS por linha.");
      return;
    }
    setBusy(true);
    setStatus("");
    setError("");
    try {
      await api.management.closeReportReconciliation(scope.organizationId, scope.unitId, {
        ...data.period,
        status: nextStatus,
        checklist,
        note: normalizedNote,
        evidence: normalizedEvidence,
      });
      setStatus(
        nextStatus === "closed" ? "Conciliação fechada e auditada." : "Conciliação reaberta.",
      );
      onRefresh?.();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  const allChecked = Object.values(checklist).every(Boolean);
  return (
    <Card aria-busy={busy} className="reports-section-card reports-reconciliation-closure">
      <div className="reports-section-heading">
        <div>
          <p className="eyebrow">Fechamento auditável</p>
          <h3>{initialClosure.status === "closed" ? "Período fechado" : "Conferência pendente"}</h3>
          <p>
            {initialClosure.closedAt
              ? `Último fechamento em ${new Date(initialClosure.closedAt).toLocaleString("pt-BR")}.`
              : "Confirme as três fontes antes de encerrar o período."}
          </p>
        </div>
        <span
          className="gm-pill"
          data-tone={initialClosure.status === "closed" ? "success" : "warning"}
        >
          {initialClosure.status === "closed" ? "Fechado" : "Aberto"}
        </span>
      </div>
      <fieldset className="reports-reconciliation-checklist" disabled={!canManage || busy}>
        <legend>Checklist de conferência</legend>
        {(
          [
            ["payments", "Pagamentos conferidos"],
            ["fiscal", "Documentos fiscais conferidos"],
            ["external", "Conciliação externa conferida"],
          ] as const
        ).map(([key, label]) => (
          <label className="reports-checkbox" key={key}>
            <input
              checked={checklist[key]}
              onChange={(event) =>
                setChecklist((current) => ({ ...current, [key]: event.target.checked }))
              }
              type="checkbox"
            />
            {label}
          </label>
        ))}
      </fieldset>
      <label className="gm-field" htmlFor="reports-reconciliation-note">
        Observação obrigatória
        <Textarea
          disabled={!canManage || busy}
          id="reports-reconciliation-note"
          maxLength={1000}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          value={note}
        />
      </label>
      <label className="gm-field" htmlFor="reports-reconciliation-evidence">
        Evidências (opcional)
        <Textarea
          aria-describedby="reports-reconciliation-evidence-help"
          disabled={!canManage || busy}
          id="reports-reconciliation-evidence"
          onChange={(event) => setEvidence(event.target.value)}
          rows={3}
          value={evidence}
        />
        <small id="reports-reconciliation-evidence-help">Até 10 URLs HTTPS, uma por linha.</small>
      </label>
      {initialClosure.evidence.length > 0 && (
        <ul className="reports-reconciliation-evidence-list">
          {initialClosure.evidence.map((url) => (
            <li key={url}>
              <a href={url} rel="noreferrer" target="_blank">
                Abrir evidência
              </a>
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <div className="gm-toolbar">
          {initialClosure.status === "closed" ? (
            <Button
              disabled={busy || note.trim().length < 2}
              onClick={() => void save("open")}
              size="sm"
              variant="secondary"
            >
              Reabrir conciliação
            </Button>
          ) : (
            <Button
              disabled={busy || !allChecked || note.trim().length < 2}
              onClick={() => void save("closed")}
              size="sm"
            >
              Fechar conciliação
            </Button>
          )}
        </div>
      )}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </Card>
  );
}

export function EnhancedReportFamilyView({
  data,
  family,
  onRefresh,
  scope,
}: {
  data: ReportData;
  family: EnhancedReportFamily;
  onRefresh?: () => void;
  scope?: ManagementScope;
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
    const reconciliation = data.reportFamilies
      .reconciliation as typeof data.reportFamilies.reconciliation & {
      closure?: unknown;
    };
    const closure = parseReconciliationClosure(reconciliation.closure);
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
        <ReportReconciliationClosure
          closure={closure}
          data={data}
          onRefresh={onRefresh}
          scope={scope}
        />
      </div>
    );
  }

  const forecast = data.reportFamilies.forecast as Omit<
    typeof data.reportFamilies.forecast,
    "method"
  > & {
    available?: boolean;
    minimumSampleDays?: number;
    method?: "weekday_seasonality_v2" | string;
  };
  if (forecast.available === false) {
    return (
      <div className="reports-family-view">
        <header className="reports-section-heading">
          <div>
            <p className="eyebrow">Projeção</p>
            <h2>Previsão operacional</h2>
            <p>Projeções aparecem somente quando existe histórico suficiente para comparação.</p>
          </div>
        </header>
        <Card className="reports-section-card">
          <EmptyState
            icon="◇"
            title="Histórico insuficiente para prever"
            description={`Registre ao menos ${forecast.minimumSampleDays ?? 14} dias com movimentação. Até lá, nenhuma previsão será apresentada como confiável.`}
          />
        </Card>
      </div>
    );
  }
  return (
    <div className="reports-family-view">
      <header className="reports-section-heading">
        <div>
          <p className="eyebrow">Projeção</p>
          <h2>Previsão operacional</h2>
          <p>
            {forecast.method === "weekday_seasonality_v2"
              ? "Projeção por dia da semana, com intervalo e erro; não substitui uma meta."
              : "Média histórica transparente, com intervalo e erro; não substitui uma meta."}
          </p>
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
      {forecast.calendarSignals.length > 0 && (
        <Card className="reports-section-card">
          <div className="reports-section-heading">
            <div>
              <p className="eyebrow">Agenda futura</p>
              <h3>Reservas consideradas na previsão</h3>
              <p>O piso de demanda só altera a projeção quando supera o padrão do dia da semana.</p>
            </div>
          </div>
          <DataTable caption="Reservas futuras consideradas na previsão">
            <thead>
              <tr>
                <th>Data</th>
                <th>Reservas</th>
                <th>Pessoas</th>
                <th>Piso de demanda</th>
                <th>Aplicado</th>
              </tr>
            </thead>
            <tbody>
              {forecast.calendarSignals.map((signal) => (
                <tr key={signal.date}>
                  <th scope="row">{dateLabel(signal.date)}</th>
                  <td>{signal.reservations}</td>
                  <td>{signal.guests}</td>
                  <td>{formatMoney(signal.demandFloorCents)}</td>
                  <td>{signal.applied ? "Sim" : "Não"}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Card>
      )}
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
  const [editName, setEditName] = useState("");
  const [editVisibility, setEditVisibility] = useState<ReportView["visibility"]>("private");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const selected = useMemo(() => views.find((view) => view.id === selectedId), [selectedId, views]);
  const canShare = ["owner", "manager", "finance"].includes(scope.profileId);
  const canEditSelected = selected && (selected.visibility === "private" || canShare);

  useEffect(() => {
    setEditName(selected?.name ?? "");
    setEditVisibility(selected?.visibility ?? "private");
  }, [selected]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const parsed = parseViews(
        await api.management.reportViews(scope.organizationId, scope.unitId),
      );
      setViews(parsed);
      setSelectedId((current) =>
        parsed.some((view) => view.id === current)
          ? current
          : (parsed.find((view) => view.isDefault)?.id ?? parsed[0]?.id ?? ""),
      );
    } catch (cause) {
      setError(message(cause));
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
    setError("");
    try {
      await api.management.createReportView(scope.organizationId, scope.unitId, {
        name,
        visibility,
        query,
        isDefault: views.length === 0,
        sortOrder: views.length,
      });
      setName("");
      setStatus("Visão salva no servidor.");
      await load();
    } catch (cause) {
      setError(message(cause));
      setBusy(false);
    }
  }

  async function updateSelected(
    useCurrentQuery: boolean,
    preferences: Partial<Pick<ReportView, "isDefault" | "sortOrder">> = {},
  ) {
    if (!selected || !editName.trim()) return;
    setBusy(true);
    setStatus("");
    setError("");
    try {
      await api.management.updateReportView(scope.organizationId, scope.unitId, selected.id, {
        name: editName.trim(),
        visibility: editVisibility,
        query: useCurrentQuery ? query : selected.query,
        isDefault: preferences.isDefault ?? selected.isDefault,
        sortOrder: preferences.sortOrder ?? selected.sortOrder,
        version: selected.version,
      });
      setStatus(
        useCurrentQuery
          ? "Visão atualizada com os filtros desta análise."
          : "Nome e compartilhamento atualizados.",
      );
      await load();
    } catch (cause) {
      setError(message(cause));
      setBusy(false);
    }
  }

  async function duplicate() {
    if (!selected) return;
    setBusy(true);
    setStatus("");
    setError("");
    try {
      await api.management.createReportView(scope.organizationId, scope.unitId, {
        name: `${selected.name} (cópia)`,
        visibility: "private",
        query: selected.query,
        isDefault: false,
        sortOrder: views.length,
      });
      setStatus("Cópia privada criada. Revise o nome antes de compartilhá-la.");
      await load();
    } catch (cause) {
      setError(message(cause));
      setBusy(false);
    }
  }

  async function remove() {
    if (!selected) return;
    if (!globalThis.confirm(`Excluir a visão “${selected.name}”?`)) return;
    setBusy(true);
    setStatus("");
    setError("");
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
      setError(message(cause));
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" variant="ghost">
        Visões compartilhadas
      </Button>
      <Modal isOpen={open} onClose={() => setOpen(false)} size="lg" title="Visões salvas">
        <div aria-busy={busy} className="reports-enhancement-stack">
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
                    {view.isDefault ? "★ " : ""}
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
            </div>
          </section>
          {canEditSelected && (
            <form
              className="reports-enhancement-form reports-view-edit-form"
              onSubmit={(event) => {
                event.preventDefault();
                void updateSelected(false);
              }}
            >
              <h3>Editar visão selecionada</h3>
              <label className="gm-field" htmlFor="reports-view-edit-name">
                Nome
                <Input
                  id="reports-view-edit-name"
                  maxLength={120}
                  onChange={(event) => setEditName(event.target.value)}
                  required
                  value={editName}
                />
              </label>
              <label className="gm-field" htmlFor="reports-view-edit-visibility">
                Compartilhamento
                <NativeSelect
                  id="reports-view-edit-visibility"
                  onChange={(event) =>
                    setEditVisibility(event.target.value as ReportView["visibility"])
                  }
                  value={editVisibility}
                >
                  <option value="private">Somente eu</option>
                  {canShare && (
                    <>
                      <option value="unit">Unidade</option>
                      <option value="organization">Organização</option>
                    </>
                  )}
                </NativeSelect>
              </label>
              <div className="gm-toolbar reports-view-edit-actions">
                <Button disabled={busy || !editName.trim()} size="sm" type="submit">
                  Salvar alterações
                </Button>
                <Button
                  disabled={busy || !editName.trim()}
                  onClick={() => void updateSelected(true)}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Usar análise atual
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => void duplicate()}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Duplicar
                </Button>
                <Button
                  disabled={busy || selected.isDefault}
                  onClick={() => void updateSelected(false, { isDefault: true })}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {selected.isDefault ? "Visão padrão" : "Definir como padrão"}
                </Button>
                <Button
                  aria-label="Mover visão para cima"
                  disabled={busy || views[0]?.id === selected.id}
                  onClick={() => {
                    const previous = views[views.findIndex((view) => view.id === selected.id) - 1];
                    if (previous) void updateSelected(false, { sortOrder: previous.sortOrder - 1 });
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  ↑
                </Button>
                <Button
                  aria-label="Mover visão para baixo"
                  disabled={busy || views.at(-1)?.id === selected.id}
                  onClick={() => {
                    const next = views[views.findIndex((view) => view.id === selected.id) + 1];
                    if (next) void updateSelected(false, { sortOrder: next.sortOrder + 1 });
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  ↓
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => void remove()}
                  size="sm"
                  type="button"
                  variant="danger"
                >
                  Excluir
                </Button>
              </div>
            </form>
          )}
          <form className="reports-enhancement-form" onSubmit={save}>
            <h3>Salvar a análise atual</h3>
            <label className="gm-field" htmlFor="reports-view-name">
              Nome
              <Input
                id="reports-view-name"
                maxLength={120}
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
                {canShare ? (
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
          {busy && <p role="status">Sincronizando visões…</p>}
          {status && <p role="status">{status}</p>}
          {error && <p role="alert">{error}</p>}
        </div>
      </Modal>
    </>
  );
}

export function ReportActionCenter({
  data,
  onApply,
  scope,
}: {
  data: ReportData;
  onApply?: (query: ReportViewQuery) => void;
  scope: ManagementScope;
}) {
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<ReportAlert[]>([]);
  const [dueDates, setDueDates] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const parsed = parseAlerts(
        await api.management.reportAlerts(scope.organizationId, scope.unitId, undefined),
      );
      setAlerts(parsed.filter((alert) => alert.status === "open" || alert.status === "claimed"));
      setDueDates(
        Object.fromEntries(
          parsed.map((alert) => [alert.id, alert.dueAt ? localDateInput(alert.dueAt) : ""]),
        ),
      );
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }, [scope.organizationId, scope.unitId]);
  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  async function evaluate() {
    setBusy(true);
    setStatus("");
    setError("");
    try {
      await api.management.evaluateReportAlerts(scope.organizationId, scope.unitId, {
        ...data.period,
        comparisonMode: data.comparison?.mode ?? "previous_period",
      });
      setStatus("Indicadores avaliados sem duplicar ocorrências existentes.");
      await load();
    } catch (cause) {
      setError(message(cause));
      setBusy(false);
    }
  }

  async function update(
    alert: ReportAlert,
    changes: { status: ReportAlert["status"]; dueAt?: string | null; comment?: string },
    success: string,
  ) {
    setBusy(true);
    setStatus("");
    setError("");
    try {
      const updated = parseAlert(
        await api.management.updateReportAlert(scope.organizationId, scope.unitId, alert.id, {
          ...changes,
          version: alert.version,
        }),
      );
      if (!updated) throw new Error("A resposta da atualização do alerta é inválida.");
      setAlerts((current) =>
        updated.status === "resolved" || updated.status === "dismissed"
          ? current.filter((item) => item.id !== updated.id)
          : current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setDueDates((current) => ({
        ...current,
        [updated.id]: updated.dueAt ? localDateInput(updated.dueAt) : "",
      }));
      setComments((current) => ({ ...current, [updated.id]: "" }));
      setStatus(success);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function saveDueDate(alert: ReportAlert) {
    const nextDueAt = dueAt(dueDates[alert.id] ?? "");
    if (!nextDueAt) {
      setError("Informe uma data válida para o prazo.");
      return;
    }
    await update(alert, { status: alert.status, dueAt: nextDueAt }, "Prazo atualizado.");
  }

  async function defer(alert: ReportAlert) {
    await update(
      alert,
      { status: alert.status, dueAt: deferredDueAt(alert.dueAt) },
      "Prazo adiado por um dia.",
    );
  }

  async function addComment(alert: ReportAlert) {
    const comment = comments[alert.id]?.trim() ?? "";
    if (comment.length < 2) {
      setError("Escreva um comentário com pelo menos 2 caracteres.");
      return;
    }
    await update(alert, { status: alert.status, comment }, "Andamento registrado no histórico.");
  }

  function applySource(alert: ReportAlert) {
    if (!onApply || !alert.source.family || !alert.source.period) return;
    onApply({
      ...alert.source.period,
      comparisonMode: data.comparison?.mode ?? "previous_period",
      family: alert.source.family,
    });
    setOpen(false);
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" variant="ghost">
        Central de ações
      </Button>
      <Modal isOpen={open} onClose={() => setOpen(false)} size="lg" title="Ações dos relatórios">
        <div aria-busy={busy} className="reports-enhancement-stack">
          {data.capabilities.manageAlerts && (
            <Button disabled={busy} onClick={() => void evaluate()} size="sm" variant="secondary">
              Avaliar período atual
            </Button>
          )}
          {alerts.length ? (
            <DataTable caption="Alertas abertos e em tratamento dos relatórios">
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
                      {alert.assignedToIdentityId && (
                        <small className="reports-alert-assignee">Responsável atribuído</small>
                      )}
                      {alert.history.length > 0 && (
                        <details className="reports-alert-history">
                          <summary>Histórico ({alert.history.length})</summary>
                          <ol>
                            {alert.history.map((entry) => (
                              <li
                                key={`${entry.occurredAt}-${entry.action}-${entry.comment ?? ""}`}
                              >
                                <span>{new Date(entry.occurredAt).toLocaleString("pt-BR")}</span>
                                {entry.comment && <p>{entry.comment}</p>}
                              </li>
                            ))}
                          </ol>
                        </details>
                      )}
                    </th>
                    <td>
                      <div className="reports-alert-due">
                        <span>
                          {alert.dueAt ? dateLabel(localDateInput(alert.dueAt)) : "Sem prazo"}
                        </span>
                        {data.capabilities.manageAlerts && (
                          <div className="reports-alert-due-controls">
                            <Input
                              aria-label={`Novo prazo para ${alert.title}`}
                              min={localDateInput(new Date())}
                              onChange={(event) =>
                                setDueDates((current) => ({
                                  ...current,
                                  [alert.id]: event.target.value,
                                }))
                              }
                              type="date"
                              value={dueDates[alert.id] ?? ""}
                            />
                            <Button
                              disabled={busy || !dueDates[alert.id]}
                              onClick={() => void saveDueDate(alert)}
                              size="sm"
                              variant="ghost"
                            >
                              Salvar prazo
                            </Button>
                            <Button
                              disabled={busy}
                              onClick={() => void defer(alert)}
                              size="sm"
                              variant="ghost"
                            >
                              Adiar 1 dia
                            </Button>
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      <span
                        className="gm-pill"
                        data-tone={alert.status === "claimed" ? "info" : "warning"}
                      >
                        {alert.status === "claimed" ? "Em tratamento" : "Aberto"}
                      </span>
                    </td>
                    <td>
                      <div className="reports-alert-actions">
                        {data.capabilities.manageAlerts && (
                          <div className="reports-alert-comment">
                            <Input
                              aria-label={`Comentário sobre ${alert.title}`}
                              maxLength={500}
                              onChange={(event) =>
                                setComments((current) => ({
                                  ...current,
                                  [alert.id]: event.target.value,
                                }))
                              }
                              placeholder="Registrar andamento"
                              value={comments[alert.id] ?? ""}
                            />
                            <Button
                              disabled={busy || (comments[alert.id]?.trim().length ?? 0) < 2}
                              onClick={() => void addComment(alert)}
                              size="sm"
                              variant="ghost"
                            >
                              Comentar
                            </Button>
                          </div>
                        )}
                        {data.capabilities.manageAlerts && alert.status === "open" && (
                          <Button
                            disabled={busy}
                            onClick={() =>
                              void update(alert, { status: "claimed" }, "Ação assumida.")
                            }
                            size="sm"
                            variant="ghost"
                          >
                            Assumir
                          </Button>
                        )}
                        {onApply && alert.source.family && alert.source.period && (
                          <Button onClick={() => applySource(alert)} size="sm" variant="secondary">
                            Abrir no relatório
                          </Button>
                        )}
                        {alertHref(alert.source.route) && (
                          <a
                            className="reports-action-link"
                            href={alertHref(alert.source.route) ?? undefined}
                          >
                            Abrir origem
                          </a>
                        )}
                        {data.capabilities.manageAlerts && (
                          <>
                            <Button
                              disabled={busy}
                              onClick={() =>
                                void update(alert, { status: "resolved" }, "Ação resolvida.")
                              }
                              size="sm"
                            >
                              Resolver
                            </Button>
                            <Button
                              disabled={busy}
                              onClick={() =>
                                void update(alert, { status: "dismissed" }, "Ação descartada.")
                              }
                              size="sm"
                              variant="ghost"
                            >
                              Descartar
                            </Button>
                          </>
                        )}
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
          {status && <p role="status">{status}</p>}
          {error && <p role="alert">{error}</p>}
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
  const [operation, setOperation] = useState<"preview" | "backfill" | null>(null);
  const [preview, setPreview] = useState<ReportCostPreview | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const busy = operation !== null;
  const previewQueryKey = `${data.period.from}:${data.period.to}:${data.comparison?.mode ?? "previous_period"}`;

  useEffect(() => {
    if (!previewQueryKey) return;
    setConfirmed(false);
    setPreview(null);
    setStatus("");
    setError("");
  }, [previewQueryKey]);

  async function previewImpact() {
    setOperation("preview");
    setStatus("");
    setError("");
    setConfirmed(false);
    try {
      setPreview(
        parseCostPreview(
          await api.management.previewReportCosts(scope.organizationId, scope.unitId, {
            ...data.period,
            comparisonMode: data.comparison?.mode ?? "previous_period",
          }),
        ),
      );
    } catch (cause) {
      setPreview(null);
      setError(message(cause));
    } finally {
      setOperation(null);
    }
  }

  async function run() {
    if (!preview || preview.estimatedCount < 1) return;
    setOperation("backfill");
    setStatus("");
    setError("");
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
      setPreview(null);
      if (onRefresh) globalThis.setTimeout(onRefresh, 1_200);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setOperation(null);
    }
  }
  return (
    <Card aria-busy={busy} className="reports-section-card reports-cost-backfill">
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
      <div className="gm-toolbar">
        <Button disabled={busy} onClick={() => void previewImpact()} size="sm" variant="secondary">
          {operation === "preview" ? "Calculando impacto…" : "Ver impacto antes de alterar"}
        </Button>
      </div>
      {preview && preview.candidateCount < 1 && (
        <EmptyState
          icon="✓"
          title="Custos históricos completos"
          description="Nenhum item deste período precisa receber custo estimado."
        />
      )}
      {preview && preview.candidateCount > 0 && (
        <section aria-label="Prévia da recomposição de custos" className="reports-cost-preview">
          <div className="reports-cost-preview__summary">
            <div>
              <span>Itens sem custo</span>
              <strong>{preview.candidateCount.toLocaleString("pt-BR")}</strong>
            </div>
            <div>
              <span>Podem ser estimados</span>
              <strong>{preview.estimatedCount.toLocaleString("pt-BR")}</strong>
            </div>
            <div>
              <span>Continuarão indisponíveis</span>
              <strong>{preview.unavailableCount.toLocaleString("pt-BR")}</strong>
            </div>
            <div>
              <span>Total estimado</span>
              <strong>{formatMoney(preview.estimatedTotalCents)}</strong>
            </div>
            <div>
              <span>Cobertura após recomposição</span>
              <strong>{percent(preview.coverageAfter)}</strong>
            </div>
          </div>
          {preview.unavailableCount > 0 && (
            <Callout tone="warning">
              <strong>O cadastro ainda não cobre todos os itens</strong>
              <span>
                {preview.unavailableCount.toLocaleString("pt-BR")} item(ns) continuarão sem custo e
                não entrarão no cálculo de margem.
              </span>
            </Callout>
          )}
          {preview.estimatedCount > 0 && (
            <>
              <label className="reports-checkbox">
                <input
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  type="checkbox"
                />
                Confirmo a estimativa de {preview.estimatedCount.toLocaleString("pt-BR")} item(ns)
                entre {dateLabel(data.period.from)} e {dateLabel(data.period.to)}, usando o custo
                atual do cadastro e mantendo os custos exatos existentes.
              </label>
              <Button disabled={!confirmed || busy} onClick={() => void run()} size="sm">
                {operation === "backfill" ? "Processando…" : "Confirmar custos estimados"}
              </Button>
            </>
          )}
        </section>
      )}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </Card>
  );
}
