// biome-ignore-all lint/a11y/noLabelWithoutControl: shadcn-compatible controls render native form elements nested by these labels
import {
  Button,
  Callout,
  Card,
  DataTable,
  EmptyState,
  Icon,
  Input,
  Modal,
  NativeSelect,
  SegmentedTabs,
} from "@giromesa/ui";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ApiClientError, api } from "../../api";
import {
  dateLabel,
  type ManagementScope,
  parseReportBudgets,
  parseReportDrillDown,
  parseReportExport,
  parseReportExports,
  parseReportSchedules,
  parseReports,
  RemoteGate,
  type ReportBudgetItem,
  type ReportBudgetMetric,
  type ReportComparisonMode,
  type ReportData,
  type ReportDrillDownData,
  type ReportDrillDownDimension,
  type ReportExportData,
  type ReportScheduleData,
  useRemote,
} from "../../management.shared";
import { parseRoute, routeHref } from "../../router";
import { formatMoney } from "../../rules";
import {
  EnhancedReportFamilyView,
  ReportActionCenter,
  ReportCostBackfill,
  type ReportViewFamily,
  ReportViewManager,
} from "./ReportEnhancements";
import "./reports.css";

export interface ReportPeriod {
  from: string;
  to: string;
}

interface ReportFilters {
  period: ReportPeriod;
  comparisonMode: ReportComparisonMode;
}

interface SavedReportFilter extends ReportFilters {
  id: string;
}

type BreakdownId = "products" | "categories" | "channels" | "paymentMethods";
type ReportFamilyId =
  | "overview"
  | "sales"
  | "exceptions"
  | "inventory"
  | "purchasing"
  | "operations"
  | "profitability"
  | "multiunit"
  | "quality"
  | "labor"
  | "reconciliation"
  | "forecast";

const breakdownTabs: Array<{ id: BreakdownId; label: string }> = [
  { id: "products", label: "Produtos" },
  { id: "categories", label: "Categorias" },
  { id: "channels", label: "Canais" },
  { id: "paymentMethods", label: "Pagamentos" },
];

const reportFamilyTabs: Array<{ id: ReportFamilyId; label: string }> = [
  { id: "overview", label: "Visão geral" },
  { id: "sales", label: "Vendas" },
  { id: "exceptions", label: "Descontos e cancelamentos" },
  { id: "inventory", label: "Estoque" },
  { id: "purchasing", label: "Compras" },
  { id: "operations", label: "Operação" },
  { id: "profitability", label: "Rentabilidade" },
  { id: "multiunit", label: "Multiunidade" },
  { id: "labor", label: "Mão de obra" },
  { id: "reconciliation", label: "Fiscal e pagamentos" },
  { id: "forecast", label: "Previsão" },
  { id: "quality", label: "Qualidade dos dados" },
];

function reportFamily(value: string | null): ReportFamilyId {
  return reportFamilyTabs.some((item) => item.id === value)
    ? (value as ReportFamilyId)
    : "overview";
}

function inputDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function defaultReportPeriod(now = new Date()): ReportPeriod {
  return {
    from: inputDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: inputDate(now),
  };
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function todayInTimezone(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone: timezone,
      year: "numeric",
    }).formatToParts(new Date());
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    return inputDate(new Date());
  }
}

const comparisonModes: Array<{ value: ReportComparisonMode; label: string }> = [
  { value: "previous_period", label: "Período anterior" },
  { value: "previous_year", label: "Mesmo período do ano anterior" },
  { value: "none", label: "Sem comparação" },
];

function presetPeriod(id: string, timezone: string): ReportPeriod {
  const today = todayInTimezone(timezone);
  if (id === "today") return { from: today, to: today };
  if (id === "7days") return { from: shiftDate(today, -6), to: today };
  if (id === "30days") return { from: shiftDate(today, -29), to: today };
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

function validReportPeriod(period: ReportPeriod): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period.from) || !/^\d{4}-\d{2}-\d{2}$/.test(period.to)) {
    return false;
  }
  const from = Date.parse(`${period.from}T00:00:00.000Z`);
  const to = Date.parse(`${period.to}T00:00:00.000Z`);
  return (
    Number.isFinite(from) && Number.isFinite(to) && from <= to && to - from <= 366 * 86_400_000
  );
}

function validComparisonMode(value: unknown): value is ReportComparisonMode {
  return value === "previous_period" || value === "previous_year" || value === "none";
}

function favoriteId(filters: ReportFilters): string {
  return `${filters.period.from}:${filters.period.to}:${filters.comparisonMode}`;
}

export function parseSavedReportFilters(value: string | null): SavedReportFilter[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const entry = candidate as Record<string, unknown>;
      const periodEntry = entry.period;
      if (!periodEntry || typeof periodEntry !== "object") return [];
      const periodRecord = periodEntry as Record<string, unknown>;
      const period = {
        from: typeof periodRecord.from === "string" ? periodRecord.from : "",
        to: typeof periodRecord.to === "string" ? periodRecord.to : "",
      };
      if (!validReportPeriod(period) || !validComparisonMode(entry.comparisonMode)) return [];
      const filters = { period, comparisonMode: entry.comparisonMode };
      return [{ ...filters, id: favoriteId(filters) }];
    });
  } catch {
    return [];
  }
}

export function reportFiltersFromUrl(
  url: URL,
  scope: Pick<ManagementScope, "organizationId" | "unitId">,
): ReportFilters | null {
  if (
    url.searchParams.get("reportOrganization") !== scope.organizationId ||
    url.searchParams.get("reportUnit") !== scope.unitId
  ) {
    return null;
  }
  const period = {
    from: url.searchParams.get("reportFrom") ?? "",
    to: url.searchParams.get("reportTo") ?? "",
  };
  const candidate = url.searchParams.get("reportComparison");
  if (!validReportPeriod(period)) return null;
  return {
    period,
    comparisonMode: validComparisonMode(candidate) ? candidate : "previous_period",
  };
}

export function reportUrl(
  currentUrl: URL,
  scope: Pick<ManagementScope, "organizationId" | "unitId">,
  filters: ReportFilters,
): URL {
  const url = new URL(currentUrl);
  url.searchParams.set("reportOrganization", scope.organizationId);
  url.searchParams.set("reportUnit", scope.unitId);
  url.searchParams.set("reportFrom", filters.period.from);
  url.searchParams.set("reportTo", filters.period.to);
  url.searchParams.set("reportComparison", filters.comparisonMode);
  url.hash = "#/reports";
  return url;
}

function moneyOrUnavailable(value: number | null): string {
  return value === null ? "Indisponível" : formatMoney(value);
}

function periodLabel(period: ReportPeriod): string {
  return `${dateLabel(period.from)} a ${dateLabel(period.to)}`;
}

function comparisonLabel(data: ReportData): string {
  const change = data.comparison?.changePercent;
  if (change === null || change === undefined) return "Sem base anterior comparável";
  const value = new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
    signDisplay: "exceptZero",
  }).format(change);
  const baseline = data.comparison?.mode === "previous_year" ? "ano anterior" : "período anterior";
  return `${value}% vs. ${baseline}`;
}

function favoriteLabel(filter: ReportFilters): string {
  const comparison = comparisonModes.find((mode) => mode.value === filter.comparisonMode)?.label;
  return `${periodLabel(filter.period)} · ${comparison ?? "Sem comparação"}`;
}

export function RealReportsPage({ scope }: { scope: ManagementScope }) {
  const initial = (() => {
    if (typeof window === "undefined") {
      return { period: defaultReportPeriod(), comparisonMode: "previous_period" } as ReportFilters;
    }
    return (
      reportFiltersFromUrl(new URL(window.location.href), scope) ?? {
        period: defaultReportPeriod(),
        comparisonMode: "previous_period",
      }
    );
  })();
  const [draftPeriod, setDraftPeriod] = useState(initial.period);
  const [period, setPeriod] = useState(initial.period);
  const [draftComparisonMode, setDraftComparisonMode] = useState(initial.comparisonMode);
  const [comparisonMode, setComparisonMode] = useState(initial.comparisonMode);
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [copyStatus, setCopyStatus] = useState("");
  const favoritesStorageKey = `gm:reports:favorites:${scope.organizationId}:${scope.unitId}:${scope.profileId}`;
  const [savedFilters, setSavedFilters] = useState<SavedReportFilter[]>(() =>
    typeof window === "undefined"
      ? []
      : parseSavedReportFilters(window.localStorage.getItem(favoritesStorageKey)),
  );
  const [favoriteStatus, setFavoriteStatus] = useState("");
  const today = todayInTimezone(timezone);
  const filtersChanged =
    draftPeriod.from !== period.from ||
    draftPeriod.to !== period.to ||
    draftComparisonMode !== comparisonMode;

  const persist = useCallback(
    (next: ReportFilters, mode: "push" | "replace" = "push") => {
      if (typeof window === "undefined" || parseRoute(window.location.hash) !== "reports") return;
      const nextUrl = reportUrl(new URL(window.location.href), scope, next);
      window.history[mode === "push" ? "pushState" : "replaceState"]({}, "", nextUrl);
    },
    [scope],
  );

  useEffect(() => {
    persist({ period, comparisonMode }, "replace");
  }, [comparisonMode, period, persist]);

  useEffect(() => {
    setSavedFilters(parseSavedReportFilters(window.localStorage.getItem(favoritesStorageKey)));
  }, [favoritesStorageKey]);

  useEffect(() => {
    const restore = () => {
      if (parseRoute(window.location.hash) !== "reports") return;
      const restored = reportFiltersFromUrl(new URL(window.location.href), scope);
      if (!restored) return;
      setPeriod(restored.period);
      setDraftPeriod(restored.period);
      setComparisonMode(restored.comparisonMode);
      setDraftComparisonMode(restored.comparisonMode);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [scope]);

  function commit(next: ReportFilters) {
    setPeriod(next.period);
    setDraftPeriod(next.period);
    setComparisonMode(next.comparisonMode);
    setDraftComparisonMode(next.comparisonMode);
    persist(next);
  }

  function applyPeriod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (filtersChanged) commit({ period: { ...draftPeriod }, comparisonMode: draftComparisonMode });
  }

  async function copyLink() {
    const url = reportUrl(new URL(window.location.href), scope, { period, comparisonMode });
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopyStatus("Link copiado.");
    } catch {
      setCopyStatus("Não foi possível copiar o link neste navegador.");
    }
  }

  function storeFavorites(next: SavedReportFilter[], message: string) {
    try {
      window.localStorage.setItem(favoritesStorageKey, JSON.stringify(next));
      setSavedFilters(next);
      setFavoriteStatus(message);
    } catch {
      setFavoriteStatus("Não foi possível salvar filtros neste navegador.");
    }
  }

  function saveCurrentFilter() {
    const filters = { period, comparisonMode };
    const id = favoriteId(filters);
    if (savedFilters.some((saved) => saved.id === id)) return;
    storeFavorites([...savedFilters, { ...filters, id }], "Filtro salvo neste navegador.");
  }

  function removeSavedFilter(id: string) {
    storeFavorites(
      savedFilters.filter((saved) => saved.id !== id),
      "Filtro removido.",
    );
  }

  return (
    <div className="growth-stack reports-page">
      <Card className="reports-filter-card">
        <div className="reports-filter-card__copy">
          <p className="eyebrow">Período de análise</p>
          <h2>Escolha o intervalo</h2>
          <p>Consulte até 366 dias de movimentação financeira desta unidade.</p>
          <fieldset className="reports-presets">
            <legend>Atalhos de período</legend>
            <div className="reports-presets__items">
              {(
                [
                  ["today", "Hoje"],
                  ["7days", "7 dias"],
                  ["30days", "30 dias"],
                  ["month", "Este mês"],
                ] as const
              ).map(([id, label]) => {
                const candidate = presetPeriod(id, timezone);
                const selected = candidate.from === period.from && candidate.to === period.to;
                return (
                  <Button
                    aria-pressed={selected}
                    key={id}
                    onClick={() => commit({ period: candidate, comparisonMode })}
                    size="sm"
                    type="button"
                    variant={selected ? "secondary" : "ghost"}
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
          </fieldset>
        </div>
        <form className="reports-filter-form" onSubmit={applyPeriod}>
          <label className="gm-field">
            Data inicial
            <Input
              className="gm-control"
              max={draftPeriod.to}
              onChange={(event) =>
                setDraftPeriod((current) => ({ ...current, from: event.target.value }))
              }
              required
              type="date"
              value={draftPeriod.from}
            />
          </label>
          <label className="gm-field">
            Data final
            <Input
              className="gm-control"
              max={today}
              min={draftPeriod.from}
              onChange={(event) =>
                setDraftPeriod((current) => ({ ...current, to: event.target.value }))
              }
              required
              type="date"
              value={draftPeriod.to}
            />
          </label>
          <label className="gm-field reports-comparison-field">
            Comparar com
            <NativeSelect
              className="gm-control"
              onChange={(event) =>
                setDraftComparisonMode(event.target.value as ReportComparisonMode)
              }
              value={draftComparisonMode}
            >
              {comparisonModes.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </NativeSelect>
          </label>
          <div className="reports-filter-actions">
            <Button disabled={!filtersChanged} size="sm" type="submit">
              Atualizar relatório
            </Button>
            <Button onClick={copyLink} size="sm" type="button" variant="ghost">
              <Icon name="copy" size={14} />
              Copiar link
            </Button>
            <span aria-live="polite" className="reports-copy-status">
              {copyStatus}
            </span>
          </div>
        </form>
        <section aria-label="Filtros salvos" className="reports-saved-filters">
          <div className="reports-saved-filters__heading">
            <strong>Filtros salvos</strong>
            <small>Neste navegador</small>
          </div>
          <div className="reports-saved-filters__items">
            {savedFilters.length ? (
              savedFilters.map((saved) => (
                <span className="reports-saved-filter" key={saved.id}>
                  <Button
                    aria-pressed={saved.id === favoriteId({ period, comparisonMode })}
                    onClick={() => commit(saved)}
                    type="button"
                  >
                    {favoriteLabel(saved)}
                  </Button>
                  <Button
                    aria-label={`Remover filtro ${favoriteLabel(saved)}`}
                    onClick={() => removeSavedFilter(saved.id)}
                    type="button"
                  >
                    ×
                  </Button>
                </span>
              ))
            ) : (
              <small>Nenhum filtro salvo.</small>
            )}
          </div>
          <Button
            disabled={savedFilters.some(
              (saved) => saved.id === favoriteId({ period, comparisonMode }),
            )}
            onClick={saveCurrentFilter}
            size="sm"
            type="button"
            variant="secondary"
          >
            Salvar filtro atual
          </Button>
          <span aria-live="polite" className="reports-favorite-status">
            {favoriteStatus}
          </span>
        </section>
      </Card>

      <ReportPeriodView
        comparisonMode={comparisonMode}
        key={`${period.from}:${period.to}:${comparisonMode}`}
        onApplyFilters={commit}
        onTimezone={setTimezone}
        period={period}
        scope={scope}
      />
    </div>
  );
}

function ReportPeriodView({
  scope,
  period,
  comparisonMode,
  onApplyFilters,
  onTimezone,
}: {
  scope: ManagementScope;
  period: ReportPeriod;
  comparisonMode: ReportComparisonMode;
  onApplyFilters: (filters: ReportFilters) => void;
  onTimezone: (timezone: string) => void;
}) {
  const loader = useCallback(
    (organizationId: string, unitId: string) =>
      api.management.reports(organizationId, unitId, { ...period, comparisonMode }),
    [comparisonMode, period],
  );
  const remote = useRemote(scope, loader, parseReports);

  useEffect(() => {
    if (remote.state.status === "ready" && remote.state.data.timezone) {
      onTimezone(remote.state.data.timezone);
    }
  }, [onTimezone, remote.state]);

  if (remote.state.status === "error" && remote.state.httpStatus === 429) {
    return (
      <RateLimitState
        onRetry={remote.retry}
        requestId={remote.state.requestId}
        retryAfterSeconds={remote.state.retryAfterSeconds ?? 30}
      />
    );
  }

  return (
    <div aria-live="polite" className="reports-results">
      <RemoteGate remote={remote}>
        {(data) => (
          <ReportContent
            data={data}
            onApplyFilters={onApplyFilters}
            onRefresh={remote.retry}
            scope={scope}
          />
        )}
      </RemoteGate>
    </div>
  );
}

function RateLimitState({
  onRetry,
  requestId,
  retryAfterSeconds,
}: {
  onRetry: () => void;
  requestId?: string;
  retryAfterSeconds: number;
}) {
  const [remaining, setRemaining] = useState(retryAfterSeconds);

  useEffect(() => {
    if (remaining <= 0) return undefined;
    const timer = globalThis.setInterval(
      () => setRemaining((current) => Math.max(0, current - 1)),
      1_000,
    );
    return () => globalThis.clearInterval(timer);
  }, [remaining]);

  return (
    <div className="reports-results">
      <Card className="remote-state reports-rate-limit" role="alert">
        <strong>Muitas consultas em sequência</strong>
        <p>
          Aguarde {remaining} segundo{remaining === 1 ? "" : "s"} antes de atualizar o relatório.
        </p>
        {requestId && (
          <small>
            Referência: <code>{requestId}</code>
          </small>
        )}
        <Button disabled={remaining > 0} onClick={onRetry} size="sm" variant="secondary">
          {remaining > 0 ? `Tentar novamente em ${remaining}s` : "Tentar novamente"}
        </Button>
      </Card>
    </div>
  );
}

interface DrillDownTarget {
  dimension: ReportDrillDownDimension;
  key: string;
  title: string;
}

export function ReportContent({
  data,
  onApplyFilters,
  scope,
  onRefresh,
}: {
  data: ReportData;
  onApplyFilters?: (filters: ReportFilters) => void;
  scope?: ManagementScope;
  onRefresh?: () => void;
}) {
  const [drillDownTarget, setDrillDownTarget] = useState<DrillDownTarget | null>(null);
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const [activeFamily, setActiveFamily] = useState<ReportFamilyId>(() =>
    typeof window === "undefined"
      ? "overview"
      : reportFamily(new URL(window.location.href).searchParams.get("reportFamily")),
  );
  const hasMovement = [
    data.cashFlow.inflowsCents,
    data.cashFlow.outflowsCents,
    data.incomeStatement.revenueCents,
    data.incomeStatement.operatingExpensesCents,
    data.comparison?.revenueCents ?? 0,
  ].some((value) => typeof value === "number" && value !== 0);

  useEffect(() => {
    if (typeof window === "undefined" || parseRoute(window.location.hash) !== "reports") return;
    const url = new URL(window.location.href);
    url.searchParams.set("reportFamily", activeFamily);
    window.history.replaceState({}, "", url);
  }, [activeFamily]);

  return (
    <>
      <section aria-label="Contexto e ações do relatório" className="reports-result-toolbar">
        <div className="reports-result-toolbar__context">
          <strong>{periodLabel(data.period)}</strong>
          <span className="gm-pill" data-tone="info">
            Fuso: {data.timezone ?? "não informado"}
          </span>
        </div>
        <div className="gm-toolbar reports-result-toolbar__actions">
          {onRefresh && (
            <Button onClick={onRefresh} size="sm" variant="ghost">
              Recarregar
            </Button>
          )}
          <Button
            aria-controls="reports-secondary-actions"
            aria-expanded={moreActionsOpen}
            className="reports-more-actions-toggle"
            onClick={() => setMoreActionsOpen((open) => !open)}
            size="sm"
            variant="ghost"
          >
            Mais ações
          </Button>
          <div
            className="reports-secondary-actions"
            data-open={moreActionsOpen}
            id="reports-secondary-actions"
          >
            {scope && (
              <ReportViewManager
                onApply={(query) => {
                  setActiveFamily(query.family);
                  onApplyFilters?.({
                    period: { from: query.from, to: query.to },
                    comparisonMode: query.comparisonMode,
                  });
                }}
                query={{
                  ...data.period,
                  comparisonMode: data.comparison?.mode ?? "previous_period",
                  family: activeFamily as ReportViewFamily,
                }}
                scope={scope}
              />
            )}
            {scope && <ReportActionCenter data={data} scope={scope} />}
            {scope && data.capabilities.export ? (
              <ReportExportActions data={data} family={activeFamily} scope={scope} />
            ) : !scope ? (
              <Button onClick={() => downloadReportCsv(data)} size="sm" variant="secondary">
                <Icon name="download" size={14} />
                Baixar CSV local
              </Button>
            ) : null}
            <Button
              aria-label="Imprimir / PDF local"
              onClick={() => window.print()}
              size="sm"
              variant="ghost"
            >
              <Icon name="download" size={14} />
              Imprimir / PDF
            </Button>
          </div>
        </div>
      </section>

      <ReportFreshness data={data} />

      <Card className="reports-family-navigation">
        <div>
          <p className="eyebrow">Biblioteca de relatórios</p>
          <h2>Escolha a análise</h2>
        </div>
        <SegmentedTabs
          active={activeFamily}
          items={reportFamilyTabs}
          label="Escolher tipo de relatório"
          onChange={setActiveFamily}
        />
      </Card>

      {activeFamily === "overview" && !hasMovement && (
        <Callout tone="info">
          <strong>Período sem movimentação</strong>
          <span>
            Não há recebimentos, pagamentos ou lançamentos por competência entre{" "}
            {periodLabel(data.period)}.
          </span>
        </Callout>
      )}

      {activeFamily === "overview" && (
        <>
          <div className="metrics-grid reports-metrics">
            <Card className="metric-card">
              <p>Receita por competência</p>
              <strong>{formatMoney(data.incomeStatement.revenueCents)}</strong>
              <small>Receita confirmada no período</small>
              {data.comparison && (
                <span
                  className="gm-pill reports-kpi-delta"
                  data-tone={
                    data.comparison.changeCents > 0
                      ? "positive"
                      : data.comparison.changeCents < 0
                        ? "danger"
                        : "info"
                  }
                >
                  {comparisonLabel(data)}
                </span>
              )}
              {scope && data.capabilities.drillDown && (
                <Button
                  onClick={() =>
                    setDrillDownTarget({
                      dimension: "metric",
                      key: "competence_revenue",
                      title: "Lançamentos da receita por competência",
                    })
                  }
                  size="sm"
                  variant="ghost"
                >
                  Ver lançamentos
                </Button>
              )}
            </Card>
            <Card className="metric-card">
              <p>Saldo de caixa</p>
              <strong className={data.cashFlow.netCents < 0 ? "negative" : "positive"}>
                {formatMoney(data.cashFlow.netCents)}
              </strong>
              <small>Entradas menos saídas</small>
              {scope && data.capabilities.drillDown && (
                <div className="metric-card__actions">
                  <Button
                    onClick={() =>
                      setDrillDownTarget({
                        dimension: "metric",
                        key: "cash_inflows",
                        title: "Entradas de caixa",
                      })
                    }
                    size="sm"
                    variant="ghost"
                  >
                    Entradas
                  </Button>
                  <Button
                    onClick={() =>
                      setDrillDownTarget({
                        dimension: "metric",
                        key: "cash_outflows",
                        title: "Saídas de caixa",
                      })
                    }
                    size="sm"
                    variant="ghost"
                  >
                    Saídas
                  </Button>
                </div>
              )}
            </Card>
            {data.capabilities.viewCosts && (
              <Card className="metric-card">
                <p>Margem bruta</p>
                <strong>{moneyOrUnavailable(data.incomeStatement.grossMarginCents)}</strong>
                <small>Receita menos CMV</small>
              </Card>
            )}
            {data.capabilities.viewCosts && (
              <Card className="metric-card">
                <p>Resultado operacional</p>
                <strong
                  className={
                    data.incomeStatement.operatingResultCents === null
                      ? undefined
                      : data.incomeStatement.operatingResultCents < 0
                        ? "negative"
                        : "positive"
                  }
                >
                  {moneyOrUnavailable(data.incomeStatement.operatingResultCents)}
                </strong>
                <small>Receita − CMV − despesas</small>
              </Card>
            )}
          </div>

          {data.capabilities.viewCosts && !data.incomeStatement.costCoverage.completeForRevenue && (
            <Callout tone="warning">
              <strong>Margem ainda não calculável</strong>
              <span>
                Existem custos ausentes no período. O GiroMesa preserva CMV, margem e resultado como
                indisponíveis para não exibir lucro incorreto.
              </span>
              {scope && (
                <a
                  className="gm-button gm-button--secondary gm-button--sm reports-data-cta"
                  href={routeHref(scope.profileId === "finance" ? "finance" : "purchases")}
                >
                  {scope.profileId === "finance"
                    ? "Revisar lançamentos financeiros"
                    : "Revisar compras e custos"}
                </a>
              )}
            </Callout>
          )}

          {scope &&
            data.capabilities.backfillCosts &&
            !data.incomeStatement.costCoverage.completeForRevenue && (
              <ReportCostBackfill data={data} onRefresh={onRefresh} scope={scope} />
            )}

          <BudgetSummary budget={data.budget} />
          <DailyRevenueChart data={data} />
          <Breakdowns data={data} onDrillDown={setDrillDownTarget} />
          <FinancialStatements data={data} viewCosts={data.capabilities.viewCosts} />
          {scope && data.capabilities.manageBudget && <BudgetManager scope={scope} />}
          {scope && data.capabilities.manageSchedules && (
            <ScheduleManager
              emailDeliveryConfigured={data.capabilities.emailDeliveryConfigured}
              scope={scope}
            />
          )}
        </>
      )}
      {activeFamily !== "overview" && (
        <ReportFamilyView
          family={activeFamily}
          data={data}
          onDrillDown={setDrillDownTarget}
          scope={scope}
        />
      )}
      {scope && drillDownTarget && (
        <DrillDownModal
          onClose={() => setDrillDownTarget(null)}
          period={data.period}
          scope={scope}
          target={drillDownTarget}
        />
      )}
    </>
  );
}

function FamilyMetric({
  label,
  note,
  tone,
  value,
}: {
  label: string;
  note: string;
  tone?: "positive" | "negative";
  value: string;
}) {
  return (
    <Card className="metric-card">
      <p>{label}</p>
      <strong className={tone}>{value}</strong>
      <small>{note}</small>
    </Card>
  );
}

const familyMetricLabels: Record<string, string> = {
  revenueCents: "Receita",
  closedTabs: "Contas fechadas",
  averageTicketCents: "Ticket médio",
  canceledValueCents: "Valor cancelado",
  discountCents: "Descontos",
  lossQuantity: "Quantidade perdida",
  lossValueCents: "Valor das perdas",
  orderedCents: "Valor pedido",
  receivedCents: "Valor recebido",
  tableTurnovers: "Giros de mesa",
  averageServiceMinutes: "Tempo médio (min)",
  grossMarginCents: "Margem bruta",
};

function FamilyComparisonCard({
  comparison,
}: {
  comparison: ReportData["reportFamilies"]["sales"]["comparison"];
}) {
  const entries = Object.entries(comparison).filter(([, value]) => value.previous !== null);
  if (!entries.length) return null;
  return (
    <Card className="reports-section-card">
      <div className="reports-section-heading">
        <div>
          <p className="eyebrow">Comparação</p>
          <h2>Atual x referência</h2>
        </div>
      </div>
      <DataTable caption="Comparação dos indicadores com o período de referência">
        <thead>
          <tr>
            <th>Indicador</th>
            <th>Atual</th>
            <th>Referência</th>
            <th>Variação</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, value]) => {
            const currency = key.endsWith("Cents");
            const format = (amount: number | null) =>
              amount === null
                ? "Indisponível"
                : currency
                  ? formatMoney(amount)
                  : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(amount);
            return (
              <tr key={key}>
                <th scope="row">{familyMetricLabels[key] ?? key}</th>
                <td>{format(value.current)}</td>
                <td>{format(value.previous)}</td>
                <td>
                  {value.changePercent === null
                    ? "Indisponível"
                    : `${new Intl.NumberFormat("pt-BR", {
                        maximumFractionDigits: 1,
                        signDisplay: "exceptZero",
                      }).format(value.changePercent)}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>
    </Card>
  );
}

function ReportFamilyView({
  data,
  family,
  onDrillDown,
  scope,
}: {
  data: ReportData;
  family: Exclude<ReportFamilyId, "overview">;
  onDrillDown: (target: DrillDownTarget) => void;
  scope?: ManagementScope;
}) {
  const report = data.reportFamilies;
  const number = (value: number) =>
    new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value);

  if (family === "labor" || family === "reconciliation" || family === "forecast") {
    return <EnhancedReportFamilyView data={data} family={family} />;
  }

  if (family === "sales") {
    return (
      <div className="reports-family-view">
        <div className="reports-section-heading">
          <div>
            <p className="eyebrow">Vendas</p>
            <h2>Desempenho comercial</h2>
            <p>Contas fechadas, ticket médio e consumo por cliente no período.</p>
          </div>
        </div>
        <div className="metrics-grid reports-metrics">
          <FamilyMetric
            label="Vendas líquidas"
            note="Total das contas, com taxas e gorjetas"
            value={formatMoney(report.sales.netRevenueCents)}
          />
          <FamilyMetric
            label="Ticket médio"
            note={`${report.sales.closedTabs} contas fechadas`}
            value={moneyOrUnavailable(report.sales.averageTicketCents)}
          />
          <FamilyMetric
            label="Consumo por cliente"
            note={`${report.sales.guests} clientes informados`}
            value={moneyOrUnavailable(report.sales.averageSpendPerGuestCents)}
          />
          <FamilyMetric
            label="Descontos"
            note="Consolidado nas contas fechadas"
            value={formatMoney(report.sales.discountsCents)}
          />
        </div>
        <FamilyComparisonCard comparison={report.sales.comparison} />
        <Card className="reports-section-card">
          <div className="reports-section-heading">
            <div>
              <p className="eyebrow">Faixa horária</p>
              <h2>Vendas por hora</h2>
            </div>
          </div>
          {report.sales.hourly.length ? (
            <DataTable caption="Contas e receita por hora de fechamento">
              <thead>
                <tr>
                  <th>Hora</th>
                  <th>Contas</th>
                  <th>Receita</th>
                </tr>
              </thead>
              <tbody>
                {report.sales.hourly.map((row) => (
                  <tr key={row.hour}>
                    <th scope="row">{String(row.hour).padStart(2, "0")}:00</th>
                    <td>{number(row.closedTabs)}</td>
                    <td>{formatMoney(row.revenueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <EmptyState
              icon="◷"
              title="Sem vendas por hora"
              description="Não houve contas fechadas no período."
            />
          )}
        </Card>
        <DailyRevenueChart data={data} />
        <Breakdowns data={data} onDrillDown={onDrillDown} />
      </div>
    );
  }

  if (family === "exceptions") {
    return (
      <div className="reports-family-view">
        <div className="reports-section-heading">
          <div>
            <p className="eyebrow">Exceções</p>
            <h2>Descontos e cancelamentos</h2>
            <p>Ocorrências registradas nos itens de contas fechadas.</p>
          </div>
        </div>
        <div className="metrics-grid reports-metrics">
          <FamilyMetric
            label="Itens cancelados"
            note="Quantidade retirada das contas"
            value={number(report.exceptions.canceledItems)}
          />
          <FamilyMetric
            label="Valor cancelado"
            note="Valor potencial dos itens cancelados"
            value={formatMoney(report.exceptions.canceledValueCents)}
          />
          <FamilyMetric
            label="Itens com desconto"
            note="Itens ativos que receberam desconto"
            value={number(report.exceptions.discountedItems)}
          />
          <FamilyMetric
            label="Descontos consolidados"
            note="Total refletido nas contas fechadas"
            value={formatMoney(report.exceptions.tabDiscountCents)}
          />
        </div>
        <FamilyComparisonCard comparison={report.exceptions.comparison} />
        {data.capabilities.drillDown && (
          <div className="gm-toolbar">
            <Button
              onClick={() =>
                onDrillDown({
                  dimension: "exception",
                  key: "canceled_items",
                  title: "Itens cancelados",
                })
              }
              size="sm"
              variant="secondary"
            >
              Ver cancelamentos
            </Button>
            <Button
              onClick={() =>
                onDrillDown({
                  dimension: "exception",
                  key: "discounted_items",
                  title: "Itens com desconto",
                })
              }
              size="sm"
              variant="ghost"
            >
              Ver descontos
            </Button>
          </div>
        )}
        <Card className="reports-section-card">
          <div className="reports-section-heading">
            <div>
              <p className="eyebrow">Auditoria</p>
              <h2>Motivos de cancelamento</h2>
            </div>
          </div>
          {report.exceptions.cancellationReasons.length ? (
            <DataTable caption="Cancelamentos agrupados por motivo">
              <thead>
                <tr>
                  <th scope="col">Motivo</th>
                  <th scope="col">Itens</th>
                  <th scope="col">Valor potencial</th>
                </tr>
              </thead>
              <tbody>
                {report.exceptions.cancellationReasons.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td>{number(row.quantity)}</td>
                    <td>{formatMoney(row.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <EmptyState
              description="Nenhum item cancelado foi registrado no período."
              icon="✓"
              title="Sem cancelamentos"
            />
          )}
        </Card>
      </div>
    );
  }

  if (family === "inventory") {
    return (
      <div className="reports-family-view">
        <div className="reports-section-heading">
          <div>
            <p className="eyebrow">Estoque</p>
            <h2>Perdas e cobertura atual</h2>
            <p>Perdas do período e fotografia do saldo no momento da consulta.</p>
          </div>
          {scope && (
            <a
              className="gm-button gm-button--secondary gm-button--sm"
              href={routeHref("inventory")}
            >
              Abrir estoque
            </a>
          )}
        </div>
        <Callout tone="info">
          <strong>Dois recortes diferentes</strong>
          <span>
            Perdas respeitam o período; rupturas, baixo estoque e valor usam o saldo atual.
          </span>
        </Callout>
        <div className="metrics-grid reports-metrics">
          <FamilyMetric
            label="Eventos de perda"
            note={`${number(report.inventory.lossQuantity)} unidades registradas`}
            value={number(report.inventory.lossEvents)}
          />
          <FamilyMetric
            label="Itens em ruptura"
            note="Saldo atual igual ou inferior a zero"
            tone={report.inventory.stockoutItems > 0 ? "negative" : undefined}
            value={number(report.inventory.stockoutItems)}
          />
          <FamilyMetric
            label="Itens abaixo do mínimo"
            note="Saldo positivo até o estoque mínimo"
            value={number(report.inventory.lowStockItems)}
          />
          <FamilyMetric
            label="Valor do estoque"
            note="Exibido apenas com custo médio completo"
            value={moneyOrUnavailable(report.inventory.currentInventoryValueCents)}
          />
          <FamilyMetric
            label="Valor das perdas"
            note="Custo histórico das baixas por perda"
            value={moneyOrUnavailable(report.inventory.lossValueCents)}
          />
        </div>
        <FamilyComparisonCard comparison={report.inventory.comparison} />
        {data.capabilities.drillDown && (
          <div className="gm-toolbar">
            {(
              [
                ["loss", "Ver perdas"],
                ["stockout", "Ver rupturas"],
                ["low_stock", "Ver baixo estoque"],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                onClick={() =>
                  onDrillDown({
                    dimension: "inventory",
                    key,
                    title: label,
                  })
                }
                size="sm"
                variant="ghost"
              >
                {label}
              </Button>
            ))}
          </div>
        )}
        <Card className="reports-section-card">
          <div className="reports-section-heading">
            <div>
              <p className="eyebrow">Curva ABC</p>
              <h2>Consumo e cobertura</h2>
              <p>Classificação pelo custo consumido e dias estimados com o saldo atual.</p>
            </div>
          </div>
          {report.inventory.analysis.length ? (
            <DataTable caption="Curva ABC e cobertura de estoque">
              <thead>
                <tr>
                  <th>Insumo</th>
                  <th>Classe</th>
                  <th>Consumo</th>
                  <th>Valor consumido</th>
                  <th>Cobertura</th>
                </tr>
              </thead>
              <tbody>
                {report.inventory.analysis.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{row.label}</th>
                    <td>{row.abcClass ?? "Indisponível"}</td>
                    <td>{number(row.consumedQuantity)}</td>
                    <td>{moneyOrUnavailable(row.consumedValueCents)}</td>
                    <td>
                      {row.coverageDays === null
                        ? "Indisponível"
                        : `${number(row.coverageDays)} dias`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <EmptyState
              icon="◇"
              title="Sem consumo de estoque"
              description="A curva ABC aparecerá após consumos registrados no período."
            />
          )}
        </Card>
      </div>
    );
  }

  if (family === "purchasing") {
    return (
      <div className="reports-family-view">
        <div className="reports-section-heading">
          <div>
            <p className="eyebrow">Compras</p>
            <h2>Pedidos, recebimentos e fornecedores</h2>
            <p>Pedidos criados e recebimentos efetivados no período selecionado.</p>
          </div>
          {scope && (
            <a
              className="gm-button gm-button--secondary gm-button--sm"
              href={routeHref("purchases")}
            >
              Abrir compras
            </a>
          )}
        </div>
        <div className="metrics-grid reports-metrics">
          <FamilyMetric
            label="Pedidos criados"
            note={`${report.purchasing.canceledOrders} cancelados`}
            value={number(report.purchasing.orderCount)}
          />
          <FamilyMetric
            label="Valor pedido"
            note="Pedidos criados no período"
            value={moneyOrUnavailable(report.purchasing.orderedCents)}
          />
          <FamilyMetric
            label="Recebimentos"
            note="Recebimentos efetivados no período"
            value={number(report.purchasing.receiptCount)}
          />
          <FamilyMetric
            label="Valor recebido"
            note="Somente recebimentos não estornados"
            value={moneyOrUnavailable(report.purchasing.receivedCents)}
          />
        </div>
        <Card className="reports-section-card">
          <div className="reports-section-heading">
            <div>
              <p className="eyebrow">Fornecedores</p>
              <h2>Movimentação por parceiro</h2>
            </div>
          </div>
          {report.purchasing.suppliers.length ? (
            <DataTable caption="Pedidos e recebimentos por fornecedor">
              <thead>
                <tr>
                  <th scope="col">Fornecedor</th>
                  <th scope="col">Pedidos</th>
                  <th scope="col">Valor pedido</th>
                  <th scope="col">Recebimentos</th>
                  <th scope="col">Valor recebido</th>
                </tr>
              </thead>
              <tbody>
                {report.purchasing.suppliers.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{row.label}</th>
                    <td>{number(row.orderCount)}</td>
                    <td>{moneyOrUnavailable(row.orderedCents)}</td>
                    <td>{number(row.receiptCount)}</td>
                    <td>{moneyOrUnavailable(row.receivedCents)}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <EmptyState
              description="Não houve pedidos ou recebimentos no período."
              icon="◇"
              title="Sem movimentação de compras"
            />
          )}
        </Card>
        <FamilyComparisonCard comparison={report.purchasing.comparison} />
        <Card className="reports-section-card">
          <div className="reports-section-heading">
            <div>
              <p className="eyebrow">Desempenho</p>
              <h2>Prazo e variação de preço por fornecedor</h2>
            </div>
          </div>
          {report.purchasing.supplierPerformance.length ? (
            <DataTable caption="Desempenho dos fornecedores">
              <thead>
                <tr>
                  <th>Fornecedor</th>
                  <th>Entregas no prazo</th>
                  <th>Prazo médio</th>
                  <th>Variação de preço</th>
                  <th>Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {report.purchasing.supplierPerformance.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{row.label}</th>
                    <td>
                      {row.onTimeRatePercent === null
                        ? "Indisponível"
                        : `${number(row.onTimeRatePercent)}%`}
                    </td>
                    <td>
                      {row.averageLeadDays === null
                        ? "Indisponível"
                        : `${number(row.averageLeadDays)} dias`}
                    </td>
                    <td>
                      {row.priceVariancePercent === null
                        ? "Indisponível"
                        : `${number(row.priceVariancePercent)}%`}
                    </td>
                    <td>
                      {data.capabilities.drillDown && (
                        <Button
                          onClick={() =>
                            onDrillDown({
                              dimension: "purchase",
                              key: row.key,
                              title: `Compras de ${row.label}`,
                            })
                          }
                          size="sm"
                          variant="ghost"
                        >
                          Abrir
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <EmptyState
              icon="◇"
              title="Sem desempenho calculável"
              description="Informe prazo esperado e registre recebimentos para comparar fornecedores."
            />
          )}
        </Card>
      </div>
    );
  }

  if (family === "operations") {
    return (
      <div className="reports-family-view">
        <div className="reports-section-heading">
          <div>
            <p className="eyebrow">Operação</p>
            <h2>Giro e atendimento das mesas</h2>
            <p>Indicadores calculados a partir das contas fechadas no período.</p>
          </div>
        </div>
        <div className="metrics-grid reports-metrics">
          <FamilyMetric
            label="Contas fechadas"
            note={`${report.operations.dineInTabs} contas de salão`}
            value={number(report.operations.closedTabs)}
          />
          <FamilyMetric
            label="Giros de mesa"
            note="Contas de salão vinculadas a uma mesa"
            value={number(report.operations.tableTurnovers)}
          />
          <FamilyMetric
            label="Clientes por conta"
            note={`${report.operations.guests} clientes informados`}
            value={
              report.operations.averageGuestsPerTab === null
                ? "Indisponível"
                : number(report.operations.averageGuestsPerTab)
            }
          />
          <FamilyMetric
            label="Tempo médio de atendimento"
            note="Da abertura ao fechamento da conta"
            value={
              report.operations.averageServiceMinutes === null
                ? "Indisponível"
                : `${number(report.operations.averageServiceMinutes)} min`
            }
          />
        </div>
        <FamilyComparisonCard comparison={report.operations.comparison} />
        {data.capabilities.drillDown && (
          <div className="gm-toolbar">
            <Button
              onClick={() =>
                onDrillDown({
                  dimension: "operation",
                  key: "closed_tabs",
                  title: "Contas fechadas",
                })
              }
              size="sm"
              variant="secondary"
            >
              Ver contas
            </Button>
            <Button
              onClick={() =>
                onDrillDown({
                  dimension: "operation",
                  key: "table_turnovers",
                  title: "Giros de mesa",
                })
              }
              size="sm"
              variant="ghost"
            >
              Ver giros
            </Button>
          </div>
        )}
        <Card className="reports-section-card">
          <div className="reports-section-heading">
            <div>
              <p className="eyebrow">Turnos</p>
              <h2>Resultado por turno operacional</h2>
            </div>
          </div>
          {report.operations.shifts.length ? (
            <DataTable caption="Contas, clientes, receita e tempo por turno">
              <thead>
                <tr>
                  <th>Turno</th>
                  <th>Contas</th>
                  <th>Clientes</th>
                  <th>Receita</th>
                  <th>Tempo médio</th>
                </tr>
              </thead>
              <tbody>
                {report.operations.shifts.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{row.label}</th>
                    <td>{number(row.closedTabs)}</td>
                    <td>{number(row.guests)}</td>
                    <td>{formatMoney(row.revenueCents)}</td>
                    <td>
                      {row.averageServiceMinutes === null
                        ? "Indisponível"
                        : `${number(row.averageServiceMinutes)} min`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <EmptyState
              icon="◷"
              title="Sem turnos no período"
              description="Vincule as contas ao turno operacional para comparar o serviço."
            />
          )}
        </Card>
      </div>
    );
  }

  if (family === "multiunit") {
    return (
      <div className="reports-family-view">
        <div className="reports-section-heading">
          <div>
            <p className="eyebrow">Multiunidade</p>
            <h2>Comparativo entre unidades</h2>
            <p>Visível para proprietários, respeitando o período e o fuso de cada unidade.</p>
          </div>
        </div>
        {report.multiunit.units.length ? (
          <Card className="reports-section-card">
            <DataTable caption="Ranking e desempenho comparável por unidade">
              <thead>
                <tr>
                  <th>Posição</th>
                  <th>Unidade</th>
                  <th>Contas</th>
                  <th>Receita</th>
                  <th>Ticket médio</th>
                  <th>Receita/dia</th>
                  <th>Participação</th>
                  <th>Mesma loja</th>
                </tr>
              </thead>
              <tbody>
                {report.multiunit.units.map((row) => (
                  <tr key={row.key}>
                    <td>{row.rank > 0 ? `${row.rank}º` : "—"}</td>
                    <th scope="row">{row.label}</th>
                    <td>{number(row.closedTabs)}</td>
                    <td>{formatMoney(row.revenueCents)}</td>
                    <td>{moneyOrUnavailable(row.averageTicketCents)}</td>
                    <td>{moneyOrUnavailable(row.revenuePerOperatingDayCents)}</td>
                    <td>
                      {row.organizationRevenueSharePercent === null
                        ? "Indisponível"
                        : `${number(row.organizationRevenueSharePercent)}%`}
                    </td>
                    <td>
                      {row.sameStoreChangePercent === null
                        ? "Indisponível"
                        : `${number(row.sameStoreChangePercent)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </Card>
        ) : (
          <Callout tone="info">
            <strong>Comparativo multiunidade indisponível</strong>
            <span>Este relatório exige perfil proprietário e mais de uma unidade acessível.</span>
          </Callout>
        )}
      </div>
    );
  }

  if (family === "quality") {
    return (
      <div className="reports-family-view">
        <div className="reports-section-heading">
          <div>
            <p className="eyebrow">Qualidade dos dados</p>
            <h2>Confiabilidade do relatório</h2>
            <p>Pendências que reduzem a cobertura dos indicadores apresentados.</p>
          </div>
        </div>
        <FamilyMetric
          label="Completude"
          note="Registros válidos nas fontes consultadas"
          tone={report.quality.scorePercent < 90 ? "negative" : "positive"}
          value={`${number(report.quality.scorePercent)}%`}
        />
        {report.quality.issues.length ? (
          <Card className="reports-section-card">
            <DataTable caption="Pendências de qualidade dos dados">
              <thead>
                <tr>
                  <th>Pendência</th>
                  <th>Ocorrências</th>
                  <th>Prioridade</th>
                </tr>
              </thead>
              <tbody>
                {report.quality.issues.map((issue) => (
                  <tr key={issue.key}>
                    <th scope="row">{issue.label}</th>
                    <td>{number(issue.count)}</td>
                    <td>
                      {issue.severity === "critical"
                        ? "Crítica"
                        : issue.severity === "warning"
                          ? "Atenção"
                          : "Informativa"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </Card>
        ) : (
          <Callout tone="success">
            <strong>Sem pendências detectadas</strong>
            <span>As verificações disponíveis para este período estão completas.</span>
          </Callout>
        )}
      </div>
    );
  }

  if (!data.capabilities.viewCosts) {
    return (
      <Callout tone="warning">
        <strong>Rentabilidade restrita</strong>
        <span>Seu perfil não possui permissão para visualizar custos e margens.</span>
      </Callout>
    );
  }

  return (
    <div className="reports-family-view">
      <div className="reports-section-heading">
        <div>
          <p className="eyebrow">Rentabilidade</p>
          <h2>Margem e resultado operacional</h2>
          <p>Leitura por competência, preservando valores quando os custos estão incompletos.</p>
        </div>
      </div>
      <div className="metrics-grid reports-metrics">
        <FamilyMetric
          label="Receita"
          note="Receita por competência"
          value={formatMoney(data.incomeStatement.revenueCents)}
        />
        <FamilyMetric
          label="Margem bruta"
          note="Receita menos CMV"
          value={moneyOrUnavailable(data.incomeStatement.grossMarginCents)}
        />
        <FamilyMetric
          label="Margem bruta percentual"
          note="Disponível somente com custos completos"
          value={
            report.profitability.grossMarginPercent === null
              ? "Indisponível"
              : `${number(report.profitability.grossMarginPercent)}%`
          }
        />
        <FamilyMetric
          label="Resultado operacional"
          note="Receita menos CMV e despesas"
          tone={
            data.incomeStatement.operatingResultCents !== null &&
            data.incomeStatement.operatingResultCents < 0
              ? "negative"
              : "positive"
          }
          value={moneyOrUnavailable(data.incomeStatement.operatingResultCents)}
        />
      </div>
      {!data.incomeStatement.costCoverage.completeForRevenue && (
        <Callout tone="warning">
          <strong>Custos incompletos</strong>
          <span>Margem e resultado permanecem indisponíveis para evitar lucro incorreto.</span>
        </Callout>
      )}
      <FamilyComparisonCard comparison={report.profitability.comparison} />
      <Card className="reports-section-card">
        <div className="reports-section-heading">
          <div>
            <p className="eyebrow">Produtos</p>
            <h2>Rentabilidade por item vendido</h2>
            <p>O custo é congelado no consumo de estoque para preservar o histórico.</p>
          </div>
        </div>
        {report.profitability.products.length ? (
          <DataTable caption="Receita, custo e margem por produto">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Qtd.</th>
                <th>Receita</th>
                <th>Custo</th>
                <th>Margem</th>
                <th>Margem %</th>
              </tr>
            </thead>
            <tbody>
              {report.profitability.products.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  <td>{number(row.quantity)}</td>
                  <td>{formatMoney(row.revenueCents)}</td>
                  <td>{moneyOrUnavailable(row.costCents)}</td>
                  <td>{moneyOrUnavailable(row.grossMarginCents)}</td>
                  <td>
                    {row.grossMarginPercent === null
                      ? "Indisponível"
                      : `${number(row.grossMarginPercent)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          <EmptyState
            icon="◇"
            title="Sem produtos vendidos"
            description="A rentabilidade aparecerá após vendas com consumo de estoque processado."
          />
        )}
      </Card>
    </div>
  );
}

function DailyRevenueChart({ data }: { data: ReportData }) {
  const series = data.dailySeries;
  if (!series.length) {
    return (
      <Card className="reports-section-card">
        <div className="reports-section-heading">
          <div>
            <p className="eyebrow">Comparação</p>
            <h2>Receita diária</h2>
          </div>
        </div>
        <EmptyState
          description="A série diária será exibida quando houver vendas detalhadas neste período."
          icon="↗"
          title="Sem série diária"
        />
      </Card>
    );
  }

  const width = 900;
  const height = 240;
  const inset = 24;
  const maximum = Math.max(
    1,
    ...series.flatMap((item) => [item.revenueCents, item.previousRevenueCents ?? 0]),
  );
  const point = (value: number, index: number) => {
    const x =
      series.length === 1 ? width / 2 : inset + (index / (series.length - 1)) * (width - inset * 2);
    const y = height - inset - (value / maximum) * (height - inset * 2);
    return `${x},${y}`;
  };
  const currentPoints = series.map((item, index) => point(item.revenueCents, index)).join(" ");
  const previousPoints = series
    .flatMap((item, index) =>
      item.previousRevenueCents === null ? [] : [point(item.previousRevenueCents, index)],
    )
    .join(" ");

  return (
    <Card className="reports-section-card reports-chart-card">
      <div className="reports-section-heading">
        <div>
          <p className="eyebrow">Comparação</p>
          <h2>Receita diária</h2>
          <p>{comparisonLabel(data)}</p>
        </div>
        <div className="reports-chart-legend">
          <span data-series="current">Período atual</span>
          <span data-series="previous">Período anterior</span>
        </div>
      </div>
      <figure className="reports-chart">
        <svg
          aria-labelledby="reports-chart-title reports-chart-description"
          className="reports-chart__svg"
          preserveAspectRatio="none"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          <title id="reports-chart-title">Receita diária comparada ao período anterior</title>
          <desc id="reports-chart-description">
            Série de {series.length} dias entre {dateLabel(data.period.from)} e{" "}
            {dateLabel(data.period.to)}.
          </desc>
          {[0.25, 0.5, 0.75].map((ratio) => (
            <line
              className="reports-chart__grid"
              key={ratio}
              x1={inset}
              x2={width - inset}
              y1={height * ratio}
              y2={height * ratio}
            />
          ))}
          {previousPoints && (
            <polyline
              className="reports-chart__line reports-chart__line--previous"
              points={previousPoints}
            />
          )}
          <polyline
            className="reports-chart__line reports-chart__line--current"
            points={currentPoints}
          />
        </svg>
        <figcaption className="reports-chart__axis">
          <span>{dateLabel(series[0]?.date ?? data.period.from)}</span>
          <strong>Pico {formatMoney(maximum)}</strong>
          <span>{dateLabel(series.at(-1)?.date ?? data.period.to)}</span>
        </figcaption>
      </figure>
      <table className="gm-sr-only">
        <caption>Dados diários de receita do gráfico</caption>
        <thead>
          <tr>
            <th>Data</th>
            <th>Receita atual</th>
            <th>Receita anterior</th>
          </tr>
        </thead>
        <tbody>
          {series.map((item) => (
            <tr key={item.date}>
              <td>{dateLabel(item.date)}</td>
              <td>{formatMoney(item.revenueCents)}</td>
              <td>{moneyOrUnavailable(item.previousRevenueCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

const breakdownDimensions: Record<BreakdownId, ReportDrillDownDimension> = {
  products: "product",
  categories: "category",
  channels: "channel",
  paymentMethods: "payment_method",
};

function Breakdowns({
  data,
  onDrillDown,
}: {
  data: ReportData;
  onDrillDown: (target: DrillDownTarget) => void;
}) {
  const [active, setActive] = useState<BreakdownId>("products");
  const rows = data.breakdowns[active];
  const total = rows.reduce((sum, row) => sum + row.revenueCents, 0);
  const activeLabel = breakdownTabs.find((tab) => tab.id === active)?.label ?? "Detalhamento";

  return (
    <Card className="reports-section-card reports-breakdowns">
      <div className="reports-section-heading">
        <div>
          <p className="eyebrow">Composição</p>
          <h2>Detalhamento de vendas</h2>
          <p>Receita e quantidade por origem no período selecionado.</p>
        </div>
      </div>
      <SegmentedTabs
        active={active}
        items={breakdownTabs.map((tab) => ({
          ...tab,
          count: data.breakdowns[tab.id].length,
        }))}
        label="Escolher detalhamento do relatório"
        onChange={setActive}
      />
      {rows.length ? (
        <DataTable caption={`${activeLabel} por receita`}>
          <thead>
            <tr>
              <th scope="col">{activeLabel.slice(0, -1)}</th>
              <th scope="col">Quantidade</th>
              <th scope="col">Receita</th>
              <th scope="col">Participação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">
                  {data.capabilities.drillDown ? (
                    <Button
                      className="reports-drilldown-link"
                      onClick={() =>
                        onDrillDown({
                          dimension: breakdownDimensions[active],
                          key: row.key,
                          title: `${activeLabel}: ${row.label}`,
                        })
                      }
                      type="button"
                    >
                      {row.label}
                    </Button>
                  ) : (
                    row.label
                  )}
                </th>
                <td>{new Intl.NumberFormat("pt-BR").format(row.quantity)}</td>
                <td>{formatMoney(row.revenueCents)}</td>
                <td>
                  {total
                    ? `${((row.revenueCents / total) * 100).toFixed(1).replace(".", ",")}%`
                    : "0%"}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : (
        <EmptyState
          description={`Não há dados de ${activeLabel.toLocaleLowerCase("pt-BR")} para este período.`}
          icon="◇"
          title="Sem detalhamento"
        />
      )}
    </Card>
  );
}

function FinancialStatements({ data, viewCosts }: { data: ReportData; viewCosts: boolean }) {
  const { cashFlow, incomeStatement } = data;
  return (
    <div className="quick-actions-grid reports-statements">
      <Card className="finance-entries">
        <div className="card-header">
          <div>
            <p className="eyebrow">Regime de caixa</p>
            <h2>Fluxo realizado</h2>
          </div>
          <span className="gm-pill" data-tone="info">
            Pagamentos realizados
          </span>
        </div>
        <FinancialRow
          label="Entradas"
          note="Recebimentos confirmados"
          tone="positive"
          value={cashFlow.inflowsCents}
        />
        <FinancialRow
          label="Saídas"
          note="Pagamentos confirmados"
          tone="negative"
          value={cashFlow.outflowsCents}
        />
        <FinancialRow
          label="Saldo"
          note="Movimento financeiro líquido"
          tone={cashFlow.netCents < 0 ? "negative" : "positive"}
          value={cashFlow.netCents}
        />
      </Card>

      {viewCosts && (
        <Card className="finance-entries">
          <div className="card-header">
            <div>
              <p className="eyebrow">Regime de competência</p>
              <h2>DRE gerencial</h2>
            </div>
            <span
              className="gm-pill"
              data-tone={incomeStatement.costCoverage.completeForRevenue ? "positive" : "warning"}
            >
              {incomeStatement.costCoverage.completeForRevenue
                ? "Custos completos"
                : "Custos incompletos"}
            </span>
          </div>
          {[
            ["Receita", incomeStatement.revenueCents],
            ["CMV", incomeStatement.cmvCents],
            ["Margem bruta", incomeStatement.grossMarginCents],
            ["Despesas operacionais", incomeStatement.operatingExpensesCents],
            ["Resultado operacional", incomeStatement.operatingResultCents],
          ].map(([label, value]) => (
            <FinancialRow
              key={label as string}
              label={label as string}
              note="Valor apurado no período"
              value={value as number | null}
            />
          ))}
        </Card>
      )}
    </div>
  );
}

function FinancialRow({
  label,
  note,
  tone,
  value,
}: {
  label: string;
  note: string;
  tone?: "positive" | "negative";
  value: number | null;
}) {
  return (
    <div className="finance-row">
      <span>
        <strong>{label}</strong>
        <small>{note}</small>
      </span>
      <strong className={tone}>{moneyOrUnavailable(value)}</strong>
    </div>
  );
}

function formatTimestamp(value: string | null, timezone?: string | null): string {
  if (!value) return "Não informado";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(date);
}

function coverageLabel(value: "complete" | "partial" | "unavailable"): string {
  if (value === "complete") return "Completa";
  if (value === "partial") return "Parcial";
  return "Indisponível";
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Não foi possível concluir a ação.";
  const requestId = error instanceof ApiClientError ? error.requestId : undefined;
  return requestId ? `${message} Referência: ${requestId}.` : message;
}

function ReportFreshness({ data }: { data: ReportData }) {
  if (!data.meta) return null;
  const { meta } = data;
  const sourceTotal = Object.values(meta.sourceCounts).reduce((sum, count) => sum + count, 0);
  return (
    <Card className="reports-freshness" aria-label="Atualização e cobertura dos dados">
      <div>
        <strong>Atualizado {formatTimestamp(meta.generatedAt, data.timezone)}</strong>
        <span className="reports-freshness__detail">
          Dados até {formatTimestamp(meta.dataThrough, data.timezone)} · {sourceTotal}{" "}
          registros-fonte
        </span>
      </div>
      <dl className="reports-coverage">
        {[
          ["Vendas", meta.coverage.sales],
          ["Caixa", meta.coverage.cashFlow],
          ["Custos", meta.coverage.costs],
          ["Orçamento", meta.coverage.budget],
        ].map(([label, coverage]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd
              className="gm-pill"
              data-tone={
                coverage === "complete"
                  ? "positive"
                  : coverage === "partial"
                    ? "warning"
                    : "neutral"
              }
            >
              {coverageLabel(coverage as "complete" | "partial" | "unavailable")}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function BudgetSummary({ budget }: { budget: ReportData["budget"] }) {
  if (!budget) return null;
  const targets = budget.targets;
  return (
    <Card className="reports-section-card reports-budget-summary">
      <div className="reports-section-heading">
        <div>
          <p className="eyebrow">Orçamento</p>
          <h2>Metas rateadas para o período</h2>
          <p>Rateio por dias corridos dos meses abrangidos pelo filtro.</p>
        </div>
        <span
          className="gm-pill"
          data-tone={budget.coverage === "complete" ? "positive" : "warning"}
        >
          Cobertura {coverageLabel(budget.coverage).toLocaleLowerCase("pt-BR")}
        </span>
      </div>
      <div className="reports-budget-grid">
        {[
          ["Receita POS", targets.posRevenueCents],
          ["Entradas de caixa", targets.cashInflowsCents],
          ["Saídas de caixa", targets.cashOutflowsCents],
          ["Receita por competência", targets.competenceRevenueCents],
          ["Despesas por competência", targets.competenceExpensesCents],
          ["Ticket médio", targets.averageTicketCents],
          ["Margem bruta", targets.grossMarginCents],
          ["Limite de perdas", targets.inventoryLossCents],
          ["Limite de cancelamentos", targets.canceledValueCents],
        ].map(([label, value]) => (
          <div key={label as string}>
            <span>{label}</span>
            <strong>{moneyOrUnavailable(value as number | null)}</strong>
          </div>
        ))}
      </div>
      {budget.alerts.length > 0 && (
        <ul className="reports-budget-alerts" aria-label="Alertas das metas">
          {budget.alerts.map((alert) => (
            <li
              className="gm-pill"
              data-tone={alert.status === "on_track" ? "positive" : "warning"}
              key={alert.key}
            >
              {budgetMetricLabels[alert.key as ReportBudgetMetric] ?? alert.key}:{" "}
              {alert.status === "on_track" ? "dentro da meta" : "requer atenção"}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DrillDownModal({
  scope,
  period,
  target,
  onClose,
}: {
  scope: ManagementScope;
  period: ReportPeriod;
  target: DrillDownTarget;
  onClose: () => void;
}) {
  const [data, setData] = useState<ReportDrillDownData | null>(null);
  const [rows, setRows] = useState<ReportDrillDownData["rows"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError("");
      try {
        const payload = await api.management.reportDrillDown(scope.organizationId, scope.unitId, {
          ...period,
          dimension: target.dimension,
          key: target.key,
          ...(cursor ? { cursor } : {}),
          limit: "50",
        });
        const parsed = parseReportDrillDown(payload);
        setData(parsed);
        setRows((current) => (cursor ? [...current, ...parsed.rows] : parsed.rows));
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setLoading(false);
      }
    },
    [period, scope.organizationId, scope.unitId, target.dimension, target.key],
  );

  useEffect(() => void load(), [load]);

  return (
    <Modal isOpen onClose={onClose} size="lg" title={target.title}>
      <div className="reports-dialog-stack" aria-busy={loading}>
        {error && (
          <Callout tone="danger">
            <strong>Falha ao abrir detalhes</strong>
            <span>{error}</span>
          </Callout>
        )}
        {data && (
          <div className="reports-drilldown-summary">
            <strong>{formatMoney(data.totals.amountCents)}</strong>
            <span>{new Intl.NumberFormat("pt-BR").format(data.totals.quantity)} itens</span>
          </div>
        )}
        {rows.length ? (
          <DataTable caption={`Lançamentos de ${target.title}`}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Referência</th>
                <th>Descrição</th>
                <th>Qtd.</th>
                <th>Valor</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.referenceType}:${row.referenceId}:${row.occurredAt}:${row.label}:${row.amountCents}:${row.quantity}`}
                >
                  <td>{dateLabel(row.localDate)}</td>
                  <td>
                    <code>{row.referenceId}</code>
                  </td>
                  <td>{row.label}</td>
                  <td>{new Intl.NumberFormat("pt-BR").format(row.quantity)}</td>
                  <td>{formatMoney(row.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : !loading && !error ? (
          <EmptyState
            icon="◇"
            title="Sem lançamentos"
            description="Nenhum lançamento compõe este total."
          />
        ) : null}
        {loading && <p role="status">Carregando lançamentos…</p>}
        {data?.page.nextCursor && (
          <Button
            disabled={loading}
            onClick={() => void load(data.page.nextCursor ?? undefined)}
            size="sm"
            variant="secondary"
          >
            Carregar mais
          </Button>
        )}
      </div>
    </Modal>
  );
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function ReportExportActions({
  data,
  family,
  scope,
}: {
  data: ReportData;
  family: ReportFamilyId;
  scope: ManagementScope;
}) {
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState<"csv" | "pdf" | "xlsx">("csv");
  const [status, setStatus] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<ReportExportData[]>([]);

  async function download(item: ReportExportData) {
    setBusy(true);
    setStatus("");
    try {
      const content = await api.management.reportExportContent(
        scope.organizationId,
        scope.unitId,
        item.id,
      );
      const checksum = await sha256Hex(content.blob);
      const expected = content.sha256 ?? item.sha256;
      if (expected && checksum.toLocaleLowerCase() !== expected.toLocaleLowerCase()) {
        throw new Error("O conteúdo recebido não corresponde ao hash auditado.");
      }
      saveBlob(content.blob, content.filename ?? item.filename);
      setStatus(`${item.format.toUpperCase()} auditado baixado. SHA-256 ${checksum.slice(0, 12)}…`);
    } catch (cause) {
      setStatus(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function createExport() {
    setBusy(true);
    setStatus("");
    try {
      const payload = await api.management.createReportExport(scope.organizationId, scope.unitId, {
        ...data.period,
        comparisonMode: data.comparison?.mode ?? "previous_period",
        family,
        format,
      });
      const item = parseReportExport(payload);
      if (item.status === "failed") throw new Error("A exportação auditada falhou no servidor.");
      await download(item);
    } catch (cause) {
      setStatus(errorMessage(cause));
      setBusy(false);
    }
  }

  async function openHistory() {
    setHistoryOpen(true);
    setStatus("");
    try {
      const payload = await api.management.reportExports(scope.organizationId, scope.unitId);
      setHistory(parseReportExports(payload));
    } catch (cause) {
      setStatus(errorMessage(cause));
    }
  }

  return (
    <div className="reports-export-actions">
      <label className="gm-field reports-export-format">
        <span className="sr-only">Formato da exportação</span>
        <NativeSelect
          aria-label="Formato da exportação"
          disabled={busy}
          onChange={(event) => setFormat(event.target.value as "csv" | "pdf" | "xlsx")}
          value={format}
        >
          <option value="csv">CSV</option>
          <option value="xlsx">Excel (XLSX)</option>
          <option value="pdf">PDF</option>
        </NativeSelect>
      </label>
      <Button
        aria-label={`Exportar ${format.toUpperCase()} auditado`}
        disabled={busy}
        onClick={() => void createExport()}
        size="sm"
        variant="secondary"
      >
        <Icon name="download" size={14} />
        {busy ? "Preparando…" : `${format.toUpperCase()} auditado`}
      </Button>
      <Button onClick={() => void openHistory()} size="sm" variant="ghost">
        Histórico
      </Button>
      <span aria-live="polite" className="reports-action-status">
        {status}
      </span>
      <Modal
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        size="lg"
        title="Exportações auditadas"
      >
        {history.length ? (
          <DataTable caption="Histórico de exportações auditadas">
            <thead>
              <tr>
                <th>Arquivo</th>
                <th>Formato</th>
                <th>Linhas</th>
                <th>Solicitada</th>
                <th>Integridade</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {history.map((item) => (
                <tr key={item.id}>
                  <th scope="row">{item.filename}</th>
                  <td>{item.format.toUpperCase()}</td>
                  <td>{item.rowCount}</td>
                  <td>{formatTimestamp(item.requestedAt, data.timezone)}</td>
                  <td>
                    <code>{item.sha256 ? `${item.sha256.slice(0, 12)}…` : "Não disponível"}</code>
                  </td>
                  <td>
                    <Button
                      disabled={busy || item.status !== "ready"}
                      onClick={() => void download(item)}
                      size="sm"
                      variant="ghost"
                    >
                      Baixar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          <EmptyState
            icon="⇩"
            title="Sem exportações"
            description="As exportações auditadas desta unidade aparecerão aqui."
          />
        )}
      </Modal>
    </div>
  );
}

const budgetMetricLabels: Record<ReportBudgetMetric, string> = {
  pos_revenue: "Receita POS",
  cash_inflows: "Entradas de caixa",
  cash_outflows: "Saídas de caixa",
  competence_revenue: "Receita por competência",
  competence_expenses: "Despesas por competência",
  average_ticket: "Ticket médio",
  gross_margin: "Margem bruta",
  inventory_loss: "Limite de perdas de estoque",
  canceled_value: "Limite de cancelamentos",
};

function BudgetManager({ scope }: { scope: ManagementScope }) {
  const [open, setOpen] = useState(false);
  const [months, setMonths] = useState<Array<{ month: string; items: ReportBudgetItem[] }>>([]);
  const [month, setMonth] = useState(() => inputDate(new Date()).slice(0, 7));
  const [metric, setMetric] = useState<ReportBudgetMetric>("pos_revenue");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setStatus("");
    try {
      setMonths(
        parseReportBudgets(await api.management.reportBudgets(scope.organizationId, scope.unitId)),
      );
    } catch (cause) {
      setStatus(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }, [scope.organizationId, scope.unitId]);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  const current = months
    .find((entry) => entry.month === month)
    ?.items.find((item) => item.metric === metric);

  useEffect(() => {
    setAmount(current ? (current.targetCents / 100).toFixed(2).replace(".", ",") : "");
  }, [current]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const targetCents = Math.round(Number(amount.replace(",", ".")) * 100);
    if (!Number.isFinite(targetCents) || targetCents < 0) {
      setStatus("Informe uma meta válida, maior ou igual a zero.");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      await api.management.updateReportBudget(scope.organizationId, scope.unitId, month, {
        metric,
        targetCents,
        ...(current ? { version: current.version } : {}),
      });
      setStatus("Meta mensal salva e auditada.");
      await load();
    } catch (cause) {
      setStatus(errorMessage(cause));
      setBusy(false);
    }
  }

  return (
    <Card className="reports-section-card reports-admin-card">
      <div className="reports-section-heading">
        <div>
          <p className="eyebrow">Planejamento</p>
          <h2>Metas mensais</h2>
          <p>Defina valores mensais; o relatório faz o rateio no servidor.</p>
        </div>
        <Button onClick={() => setOpen(true)} size="sm" variant="secondary">
          Gerenciar metas
        </Button>
      </div>
      <Modal isOpen={open} onClose={() => setOpen(false)} title="Gerenciar metas mensais">
        <form className="reports-dialog-form" onSubmit={save} aria-busy={busy}>
          <label className="gm-field">
            Mês
            <Input
              className="gm-control"
              onChange={(event) => setMonth(event.target.value)}
              required
              type="month"
              value={month}
            />
          </label>
          <label className="gm-field">
            Indicador
            <NativeSelect
              className="gm-control"
              onChange={(event) => setMetric(event.target.value as ReportBudgetMetric)}
              value={metric}
            >
              {Object.entries(budgetMetricLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="gm-field">
            Meta em reais
            <Input
              className="gm-control"
              inputMode="decimal"
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0,00"
              required
              value={amount}
            />
          </label>
          <div className="gm-toolbar">
            <Button disabled={busy} type="submit">
              Salvar meta
            </Button>
            <Button onClick={() => setOpen(false)} type="button" variant="ghost">
              Cancelar
            </Button>
          </div>
          <span aria-live="polite">{status}</span>
        </form>
      </Modal>
    </Card>
  );
}

type ScheduleDraft = Omit<ReportScheduleData, "id" | "nextRunAt" | "lastRunAt" | "version"> & {
  version?: number;
  id?: string;
};

function emptySchedule(): ScheduleDraft {
  return {
    name: "",
    frequency: "weekly",
    weekday: 1,
    dayOfMonth: null,
    localTime: "08:00",
    range: "previous_week",
    comparisonMode: "previous_period",
    family: "overview",
    format: "csv",
    delivery: "in_app",
    enabled: true,
  };
}

function ScheduleManager({
  scope,
  emailDeliveryConfigured,
}: {
  scope: ManagementScope;
  emailDeliveryConfigured: boolean;
}) {
  const [items, setItems] = useState<ReportScheduleData[]>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ScheduleDraft>(emptySchedule);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setItems(
        parseReportSchedules(
          await api.management.reportSchedules(scope.organizationId, scope.unitId),
        ),
      );
    } catch (cause) {
      setStatus(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }, [scope.organizationId, scope.unitId]);

  useEffect(() => void load(), [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    const body = {
      name: draft.name,
      frequency: draft.frequency,
      weekday: draft.frequency === "weekly" ? draft.weekday : null,
      dayOfMonth: draft.frequency === "monthly" ? draft.dayOfMonth : null,
      localTime: draft.localTime,
      range: draft.frequency === "weekly" ? "previous_week" : "previous_month",
      comparisonMode: draft.comparisonMode,
      family: draft.family,
      format: draft.format,
      delivery: draft.delivery,
      enabled: draft.enabled,
      ...(draft.version === undefined ? {} : { version: draft.version }),
    };
    try {
      if (draft.id)
        await api.management.updateReportSchedule(
          scope.organizationId,
          scope.unitId,
          draft.id,
          body,
        );
      else await api.management.createReportSchedule(scope.organizationId, scope.unitId, body);
      setOpen(false);
      setDraft(emptySchedule());
      setStatus("Agendamento salvo.");
      await load();
    } catch (cause) {
      setStatus(errorMessage(cause));
      setBusy(false);
    }
  }

  async function remove(item: ReportScheduleData) {
    if (!window.confirm(`Excluir o agendamento “${item.name}”?`)) return;
    setBusy(true);
    setStatus("");
    try {
      await api.management.deleteReportSchedule(
        scope.organizationId,
        scope.unitId,
        item.id,
        item.version,
      );
      setStatus("Agendamento excluído.");
      await load();
    } catch (cause) {
      setStatus(errorMessage(cause));
      setBusy(false);
    }
  }

  return (
    <Card className="reports-section-card reports-admin-card">
      <div className="reports-section-heading">
        <div>
          <p className="eyebrow">Automação</p>
          <h2>Agendamentos</h2>
          <p>
            Entregas semanais ou mensais no GiroMesa
            {emailDeliveryConfigured ? " ou por e-mail" : ""}.
          </p>
        </div>
        <Button
          onClick={() => {
            setDraft(emptySchedule());
            setOpen(true);
          }}
          size="sm"
          variant="secondary"
        >
          Novo agendamento
        </Button>
      </div>
      {items.length ? (
        <DataTable caption="Agendamentos de relatórios">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Relatório</th>
              <th>Formato</th>
              <th>Frequência</th>
              <th>Entrega</th>
              <th>Próxima execução</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <th scope="row">{item.name}</th>
                <td>{reportFamilyTabs.find((family) => family.id === item.family)?.label}</td>
                <td>{item.format.toUpperCase()}</td>
                <td>
                  {item.frequency === "weekly" ? "Semanal" : "Mensal"}, {item.localTime}
                </td>
                <td>{item.delivery === "email" ? "E-mail" : "No GiroMesa"}</td>
                <td>{formatTimestamp(item.nextRunAt)}</td>
                <td>
                  <div className="gm-toolbar">
                    <Button
                      onClick={() => {
                        setDraft(item);
                        setOpen(true);
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      Editar
                    </Button>
                    <Button onClick={() => void remove(item)} size="sm" variant="ghost">
                      Excluir
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : !busy ? (
        <EmptyState
          icon="◷"
          title="Sem agendamentos"
          description="Crie uma entrega recorrente quando ela for útil para a gestão."
        />
      ) : null}
      {busy && <p role="status">Atualizando agendamentos…</p>}
      <span aria-live="polite">{status}</span>
      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title={draft.id ? "Editar agendamento" : "Novo agendamento"}
      >
        <form className="reports-dialog-form" onSubmit={save}>
          <label className="gm-field">
            Nome
            <Input
              className="gm-control"
              maxLength={80}
              onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))}
              required
              value={draft.name}
            />
          </label>
          <label className="gm-field">
            Frequência
            <NativeSelect
              className="gm-control"
              onChange={(event) =>
                setDraft((value) => ({
                  ...value,
                  frequency: event.target.value as "weekly" | "monthly",
                }))
              }
              value={draft.frequency}
            >
              <option value="weekly">Semanal</option>
              <option value="monthly">Mensal</option>
            </NativeSelect>
          </label>
          {draft.frequency === "weekly" ? (
            <label className="gm-field">
              Dia da semana
              <NativeSelect
                className="gm-control"
                onChange={(event) =>
                  setDraft((value) => ({ ...value, weekday: Number(event.target.value) }))
                }
                value={draft.weekday ?? 1}
              >
                {["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"].map(
                  (label, value) => (
                    <option key={label} value={value}>
                      {label}
                    </option>
                  ),
                )}
              </NativeSelect>
            </label>
          ) : (
            <label className="gm-field">
              Dia do mês
              <Input
                className="gm-control"
                max={28}
                min={1}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, dayOfMonth: Number(event.target.value) }))
                }
                required
                type="number"
                value={draft.dayOfMonth ?? 1}
              />
            </label>
          )}
          <label className="gm-field">
            Horário da unidade
            <Input
              className="gm-control"
              onChange={(event) =>
                setDraft((value) => ({ ...value, localTime: event.target.value }))
              }
              required
              type="time"
              value={draft.localTime}
            />
          </label>
          <label className="gm-field">
            Comparação
            <NativeSelect
              className="gm-control"
              onChange={(event) =>
                setDraft((value) => ({
                  ...value,
                  comparisonMode: event.target.value as ReportComparisonMode,
                }))
              }
              value={draft.comparisonMode}
            >
              {comparisonModes.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="gm-field">
            Tipo de relatório
            <NativeSelect
              className="gm-control"
              onChange={(event) =>
                setDraft((value) => ({
                  ...value,
                  family: event.target.value as ReportFamilyId,
                }))
              }
              value={draft.family}
            >
              {reportFamilyTabs.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="gm-field">
            Formato
            <NativeSelect
              className="gm-control"
              onChange={(event) =>
                setDraft((value) => ({
                  ...value,
                  format: event.target.value as "csv" | "pdf" | "xlsx",
                }))
              }
              value={draft.format}
            >
              <option value="csv">CSV</option>
              <option value="xlsx">Excel (XLSX)</option>
              <option value="pdf">PDF</option>
            </NativeSelect>
          </label>
          <label className="gm-field">
            Entrega
            <NativeSelect
              className="gm-control"
              onChange={(event) =>
                setDraft((value) => ({
                  ...value,
                  delivery: event.target.value as "in_app" | "email",
                }))
              }
              value={draft.delivery}
            >
              <option value="in_app">No GiroMesa</option>
              {emailDeliveryConfigured && <option value="email">E-mail do usuário</option>}
            </NativeSelect>
          </label>
          <label className="reports-checkbox">
            <input
              checked={draft.enabled}
              onChange={(event) =>
                setDraft((value) => ({ ...value, enabled: event.target.checked }))
              }
              type="checkbox"
            />
            Agendamento ativo
          </label>
          <div className="gm-toolbar">
            <Button disabled={busy} type="submit">
              Salvar agendamento
            </Button>
            <Button onClick={() => setOpen(false)} type="button" variant="ghost">
              Cancelar
            </Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}

function downloadReportCsv(data: ReportData) {
  const rows: Array<Array<string | number | null>> = [
    [
      "seção",
      "tipo",
      "chave",
      "rótulo/data",
      "quantidade",
      "valor_centavos",
      "valor_anterior_centavos",
      "texto",
    ],
    ["metadados", "período", "início", data.period.from, null, null, null, null],
    ["metadados", "período", "fim", data.period.to, null, null, null, null],
    ["metadados", "unidade", "timezone", null, null, null, null, data.timezone],
    [
      "fluxo_caixa",
      "resumo",
      "entradas",
      "Entradas",
      null,
      data.cashFlow.inflowsCents,
      null,
      data.cashFlow.basis,
    ],
    [
      "fluxo_caixa",
      "resumo",
      "saídas",
      "Saídas",
      null,
      data.cashFlow.outflowsCents,
      null,
      data.cashFlow.basis,
    ],
    [
      "fluxo_caixa",
      "resumo",
      "saldo",
      "Saldo",
      null,
      data.cashFlow.netCents,
      null,
      data.cashFlow.basis,
    ],
    [
      "dre",
      "resumo",
      "receita",
      "Receita",
      null,
      data.incomeStatement.revenueCents,
      null,
      data.incomeStatement.basis,
    ],
    [
      "dre",
      "resumo",
      "cmv",
      "CMV",
      null,
      data.incomeStatement.cmvCents,
      null,
      data.incomeStatement.basis,
    ],
    [
      "dre",
      "resumo",
      "margem_bruta",
      "Margem bruta",
      null,
      data.incomeStatement.grossMarginCents,
      null,
      data.incomeStatement.basis,
    ],
    [
      "dre",
      "resumo",
      "despesas_operacionais",
      "Despesas operacionais",
      null,
      data.incomeStatement.operatingExpensesCents,
      null,
      data.incomeStatement.basis,
    ],
    [
      "dre",
      "resumo",
      "resultado_operacional",
      "Resultado operacional",
      null,
      data.incomeStatement.operatingResultCents,
      null,
      data.incomeStatement.basis,
    ],
  ];

  rows.push(
    [
      "vendas",
      "resumo",
      "contas_fechadas",
      "Contas fechadas",
      data.reportFamilies.sales.closedTabs,
      null,
      null,
      null,
    ],
    [
      "vendas",
      "resumo",
      "ticket_medio",
      "Ticket médio",
      null,
      data.reportFamilies.sales.averageTicketCents,
      null,
      null,
    ],
    [
      "excecoes",
      "resumo",
      "itens_cancelados",
      "Itens cancelados",
      data.reportFamilies.exceptions.canceledItems,
      data.reportFamilies.exceptions.canceledValueCents,
      null,
      null,
    ],
    [
      "estoque",
      "resumo",
      "perdas",
      "Eventos de perda",
      data.reportFamilies.inventory.lossEvents,
      null,
      null,
      String(data.reportFamilies.inventory.lossQuantity),
    ],
    [
      "estoque",
      "saldo_atual",
      "rupturas",
      "Itens em ruptura",
      data.reportFamilies.inventory.stockoutItems,
      null,
      null,
      null,
    ],
    [
      "compras",
      "resumo",
      "pedidos",
      "Pedidos criados",
      data.reportFamilies.purchasing.orderCount,
      data.reportFamilies.purchasing.orderedCents,
      null,
      null,
    ],
    [
      "compras",
      "resumo",
      "recebimentos",
      "Recebimentos",
      data.reportFamilies.purchasing.receiptCount,
      data.reportFamilies.purchasing.receivedCents,
      null,
      null,
    ],
    [
      "operacao",
      "resumo",
      "giros_mesa",
      "Giros de mesa",
      data.reportFamilies.operations.tableTurnovers,
      null,
      null,
      null,
    ],
    [
      "operacao",
      "resumo",
      "tempo_medio",
      "Tempo médio de atendimento",
      null,
      null,
      null,
      data.reportFamilies.operations.averageServiceMinutes === null
        ? null
        : `${data.reportFamilies.operations.averageServiceMinutes} min`,
    ],
    [
      "rentabilidade",
      "resumo",
      "margem_bruta_percentual",
      "Margem bruta percentual",
      null,
      null,
      null,
      data.reportFamilies.profitability.grossMarginPercent === null
        ? null
        : `${data.reportFamilies.profitability.grossMarginPercent}%`,
    ],
  );

  if (data.previousPeriod) {
    rows.push(
      [
        "comparação",
        "período_anterior",
        "início",
        data.previousPeriod.from,
        null,
        null,
        null,
        null,
      ],
      ["comparação", "período_anterior", "fim", data.previousPeriod.to, null, null, null, null],
    );
  }
  if (data.comparison) {
    rows.push([
      "comparação",
      "receita",
      "variação",
      null,
      null,
      data.comparison.revenueCents,
      data.comparison.previousRevenueCents,
      data.comparison.changePercent === null ? null : `${data.comparison.changePercent}%`,
    ]);
  }
  for (const item of data.dailySeries) {
    rows.push([
      "série_diária",
      "receita",
      item.date,
      item.date,
      null,
      item.revenueCents,
      item.previousRevenueCents,
      null,
    ]);
  }
  for (const tab of breakdownTabs) {
    for (const item of data.breakdowns[tab.id]) {
      rows.push([
        "detalhamento",
        tab.id,
        item.key,
        item.label,
        item.quantity,
        item.revenueCents,
        null,
        null,
      ]);
    }
  }

  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `relatorio-giromesa-${data.period.from}-${data.period.to}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const raw = String(value);
  const text = typeof value === "string" && /^\s*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
