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
} from "@giromesa/ui";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
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
  type ReportExportData,
  type ReportScheduleData,
  useRemote,
} from "../../management.shared";
import { parseRoute, routeHref } from "../../router";
import { formatMoney } from "../../rules";
import {
  type ReportFamilyId,
  ReportFamilyNavigation,
  reportFamily,
  reportFamilyTabs,
} from "./families/ReportFamilyNavigation";
import {
  defaultReportAnalysis,
  type ReportAnalysisId,
  type ReportBreakdownOrder,
  reportAnalysis,
  reportAnalysisBreakdown,
  reportAnalysisLabel,
} from "./families/report-analysis";
import {
  Breakdowns,
  breakdownTabs,
  DailyRevenueChart,
  type DrillDownTarget,
  ReportFamilyView,
} from "./families/StandardReportFamilies";
import {
  ReportActionCenter,
  ReportCostBackfill,
  type ReportViewFamily,
  ReportViewManager,
} from "./ReportEnhancements";
import "./reports-navigation.css";
import "./reports.css";

export interface ReportPeriod {
  from: string;
  to: string;
}

interface ReportFilters {
  period: ReportPeriod;
  comparisonMode: ReportComparisonMode;
  family?: ReportFamilyId;
  analysis?: ReportAnalysisId;
  order?: ReportBreakdownOrder;
}

interface SavedReportFilter extends ReportFilters {
  id: string;
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

function favoriteId(filters: ReportFilters & Partial<SavedReportFilter>): string {
  const base = `${filters.period.from}:${filters.period.to}:${filters.comparisonMode}`;
  return filters.family
    ? `${base}:${filters.family}:${filters.analysis ?? defaultReportAnalysis(filters.family)}:${filters.order ?? "revenue_desc"}`
    : base;
}

const breakdownOrders: Array<{ value: ReportBreakdownOrder; label: string }> = [
  { value: "revenue_desc", label: "Maior receita primeiro" },
  { value: "revenue_asc", label: "Menor receita primeiro" },
  { value: "quantity_desc", label: "Maior quantidade primeiro" },
  { value: "quantity_asc", label: "Menor quantidade primeiro" },
  { value: "label_asc", label: "Nome: A a Z" },
  { value: "label_desc", label: "Nome: Z a A" },
];

function validBreakdownOrder(value: unknown): value is ReportBreakdownOrder {
  return breakdownOrders.some((order) => order.value === value);
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
      const family = typeof entry.family === "string" ? reportFamily(entry.family) : undefined;
      const analysis = family
        ? reportAnalysis(typeof entry.analysis === "string" ? entry.analysis : null, family)
        : undefined;
      const order = validBreakdownOrder(entry.order) ? entry.order : undefined;
      const filters = { period, comparisonMode: entry.comparisonMode, family, analysis, order };
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
  const family = reportFamily(url.searchParams.get("reportFamily"));
  const analysis = reportAnalysis(url.searchParams.get("reportAnalysis"), family);
  const orderCandidate = url.searchParams.get("reportOrder");
  return {
    period,
    comparisonMode: validComparisonMode(candidate) ? candidate : "previous_period",
    family,
    analysis,
    order: validBreakdownOrder(orderCandidate) ? orderCandidate : "revenue_desc",
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
  if (filters.family) url.searchParams.set("reportFamily", filters.family);
  if (filters.analysis) url.searchParams.set("reportAnalysis", filters.analysis);
  if (filters.order) url.searchParams.set("reportOrder", filters.order);
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

function favoriteLabel(filter: ReportFilters & Partial<SavedReportFilter>): string {
  const comparison = comparisonModes.find((mode) => mode.value === filter.comparisonMode)?.label;
  const analysis = filter.analysis ? `${reportAnalysisLabel(filter.analysis)} · ` : "";
  return `${analysis}${periodLabel(filter.period)} · ${comparison ?? "Sem comparação"}`;
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
  const [refreshToken, setRefreshToken] = useState(0);
  const favoritesStorageKey = `gm:reports:favorites:${scope.organizationId}:${scope.unitId}:${scope.profileId}`;
  const [savedFilters, setSavedFilters] = useState<SavedReportFilter[]>(() =>
    typeof window === "undefined"
      ? []
      : parseSavedReportFilters(window.localStorage.getItem(favoritesStorageKey)),
  );
  const [favoriteStatus, setFavoriteStatus] = useState("");
  const [activeFamily, setActiveFamily] = useState<ReportFamilyId>(
    () => initial.family ?? "overview",
  );
  const [activeAnalysis, setActiveAnalysis] = useState<ReportAnalysisId>(() => {
    return initial.analysis ?? defaultReportAnalysis(initial.family ?? "overview");
  });
  const [breakdownOrder, setBreakdownOrder] = useState<ReportBreakdownOrder>(
    initial.order ?? "revenue_desc",
  );
  const today = todayInTimezone(timezone);
  const filtersChanged =
    draftPeriod.from !== period.from ||
    draftPeriod.to !== period.to ||
    draftComparisonMode !== comparisonMode;

  const persist = useCallback(
    (next: ReportFilters, mode: "push" | "replace" = "push") => {
      if (typeof window === "undefined" || parseRoute(window.location.hash) !== "reports") return;
      const nextUrl = reportUrl(new URL(window.location.href), scope, {
        ...next,
        family: next.family ?? activeFamily,
        analysis: next.analysis ?? activeAnalysis,
        order: next.order ?? breakdownOrder,
      });
      window.history[mode === "push" ? "pushState" : "replaceState"]({}, "", nextUrl);
    },
    [activeAnalysis, activeFamily, breakdownOrder, scope],
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
      const restoredFamily = restored.family ?? "overview";
      setActiveFamily(restoredFamily);
      setActiveAnalysis(restored.analysis ?? defaultReportAnalysis(restoredFamily));
      setBreakdownOrder(restored.order ?? "revenue_desc");
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
    if (filtersChanged) {
      commit({ period: { ...draftPeriod }, comparisonMode: draftComparisonMode });
      return;
    }
    setRefreshToken((current) => current + 1);
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
    const filters = {
      period,
      comparisonMode,
      family: activeFamily,
      analysis: activeAnalysis,
      order: breakdownOrder,
    };
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

  function applySavedFilter(saved: SavedReportFilter) {
    if (saved.family) setActiveFamily(saved.family);
    if (saved.analysis) setActiveAnalysis(saved.analysis);
    if (saved.order) setBreakdownOrder(saved.order);
    commit(saved);
  }

  function clearFilters() {
    const next = {
      period: defaultReportPeriod(),
      comparisonMode: "previous_period",
      family: "overview",
      analysis: "overview-managerial",
      order: "revenue_desc",
    } as const;
    setActiveFamily("overview");
    setActiveAnalysis("overview-managerial");
    setBreakdownOrder("revenue_desc");
    commit(next);
  }

  const activeBreakdown = reportAnalysisBreakdown(activeAnalysis);
  const filterSummary = `${reportAnalysisLabel(activeAnalysis)} · ${periodLabel(draftPeriod)} · ${
    comparisonModes.find((mode) => mode.value === draftComparisonMode)?.label ?? "Sem comparação"
  }${activeBreakdown ? ` · ${breakdownOrders.find((order) => order.value === breakdownOrder)?.label}` : ""}`;

  return (
    <div className="growth-stack reports-page">
      <Card className="reports-filter-card grid">
        <div className="reports-filter-card__copy">
          <p className="eyebrow">Período de análise</p>
          <h2>Escolha o intervalo</h2>
          <p>Consulte até 366 dias de movimentação financeira desta unidade.</p>
        </div>
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
          {activeBreakdown && (
            <label className="gm-field reports-order-field">
              Ordenar por
              <NativeSelect
                className="gm-control"
                onChange={(event) => setBreakdownOrder(event.target.value as ReportBreakdownOrder)}
                value={breakdownOrder}
              >
                {breakdownOrders.map((order) => (
                  <option key={order.value} value={order.value}>
                    {order.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
          )}
          <div className="reports-filter-actions">
            <Button size="sm" type="submit">
              {filtersChanged ? "Aplicar filtros" : "Atualizar dados"}
            </Button>
          </div>
        </form>
        <section aria-label="Resumo dos filtros" className="reports-active-filters">
          <div className="reports-active-filters__heading">
            <strong>Consulta preparada</strong>
            <small aria-live="polite">{filterSummary}</small>
          </div>
          <div className="reports-active-filters__chips">
            <span className="gm-pill">{reportAnalysisLabel(activeAnalysis)}</span>
            <span className="gm-pill">{periodLabel(draftPeriod)}</span>
            <span className="gm-pill">
              {comparisonModes.find((mode) => mode.value === draftComparisonMode)?.label}
            </span>
            {activeBreakdown && (
              <span className="gm-pill">
                {breakdownOrders.find((order) => order.value === breakdownOrder)?.label}
              </span>
            )}
          </div>
          <Button onClick={clearFilters} size="sm" type="button" variant="ghost">
            Limpar filtros
          </Button>
        </section>
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
                    aria-pressed={
                      saved.id ===
                      favoriteId({
                        period,
                        comparisonMode,
                        family: activeFamily,
                        analysis: activeAnalysis,
                        order: breakdownOrder,
                      })
                    }
                    onClick={() => applySavedFilter(saved)}
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
              (saved) =>
                saved.id ===
                favoriteId({
                  period,
                  comparisonMode,
                  family: activeFamily,
                  analysis: activeAnalysis,
                  order: breakdownOrder,
                }),
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
        activeAnalysis={activeAnalysis}
        activeFamily={activeFamily}
        breakdownOrder={breakdownOrder}
        comparisonMode={comparisonMode}
        key={`${period.from}:${period.to}:${comparisonMode}:${activeFamily}`}
        onApplyFilters={commit}
        onFamilyChange={setActiveFamily}
        onAnalysisChange={setActiveAnalysis}
        onTimezone={setTimezone}
        period={period}
        refreshToken={refreshToken}
        scope={scope}
      />
    </div>
  );
}

function ReportPeriodView({
  scope,
  period,
  comparisonMode,
  activeFamily,
  activeAnalysis,
  breakdownOrder,
  onApplyFilters,
  onAnalysisChange,
  onFamilyChange,
  onTimezone,
  refreshToken,
}: {
  scope: ManagementScope;
  period: ReportPeriod;
  comparisonMode: ReportComparisonMode;
  activeFamily: ReportFamilyId;
  activeAnalysis: ReportAnalysisId;
  breakdownOrder: ReportBreakdownOrder;
  onApplyFilters: (filters: ReportFilters) => void;
  onAnalysisChange: (analysis: ReportAnalysisId) => void;
  onFamilyChange: (family: ReportFamilyId) => void;
  onTimezone: (timezone: string) => void;
  refreshToken: number;
}) {
  const abortRef = useRef<AbortController | null>(null);
  const loader = useCallback(
    (organizationId: string, unitId: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      return api.management.reports(
        organizationId,
        unitId,
        {
          ...period,
          comparisonMode,
          family: activeFamily,
          minimumComparableOperatingDays: 7,
        },
        controller.signal,
      );
    },
    [activeFamily, comparisonMode, period],
  );
  const remote = useRemote(scope, loader, parseReports);
  const appliedRefreshToken = useRef(refreshToken);

  useEffect(() => {
    if (appliedRefreshToken.current === refreshToken) return;
    appliedRefreshToken.current = refreshToken;
    remote.retry();
  }, [refreshToken, remote.retry]);

  useEffect(() => () => abortRef.current?.abort(), []);

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
            activeAnalysis={activeAnalysis}
            activeFamily={activeFamily}
            breakdownOrder={breakdownOrder}
            data={data}
            onApplyFilters={onApplyFilters}
            onRefresh={remote.retry}
            onFamilyChange={onFamilyChange}
            onAnalysisChange={onAnalysisChange}
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

export function ReportContent({
  data,
  activeFamily: controlledActiveFamily,
  activeAnalysis: controlledActiveAnalysis,
  breakdownOrder = "revenue_desc",
  onApplyFilters,
  onAnalysisChange,
  onFamilyChange,
  scope,
  onRefresh,
}: {
  data: ReportData;
  activeFamily?: ReportFamilyId;
  activeAnalysis?: ReportAnalysisId;
  breakdownOrder?: ReportBreakdownOrder;
  onApplyFilters?: (filters: ReportFilters) => void;
  onAnalysisChange?: (analysis: ReportAnalysisId) => void;
  onFamilyChange?: (family: ReportFamilyId) => void;
  scope?: ManagementScope;
  onRefresh?: () => void;
}) {
  const [drillDownTarget, setDrillDownTarget] = useState<DrillDownTarget | null>(null);
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const [localActiveFamily, setLocalActiveFamily] = useState<ReportFamilyId>(() =>
    typeof window === "undefined"
      ? "overview"
      : reportFamily(new URL(window.location.href).searchParams.get("reportFamily")),
  );
  const [localActiveAnalysis, setLocalActiveAnalysis] = useState<ReportAnalysisId>(() => {
    if (typeof window === "undefined") return "overview-managerial";
    const url = new URL(window.location.href);
    const family = reportFamily(url.searchParams.get("reportFamily"));
    return reportAnalysis(url.searchParams.get("reportAnalysis"), family);
  });
  const activeFamily = controlledActiveFamily ?? localActiveFamily;
  const requestedAnalysis = controlledActiveAnalysis ?? localActiveAnalysis;
  const activeAnalysis =
    !data.capabilities.viewCosts && requestedAnalysis === "overview-income"
      ? "overview-managerial"
      : requestedAnalysis;
  const setActiveFamily = onFamilyChange ?? setLocalActiveFamily;
  const setActiveAnalysis = onAnalysisChange ?? setLocalActiveAnalysis;
  const hasMovement = [
    data.cashFlow.inflowsCents,
    data.cashFlow.outflowsCents,
    data.incomeStatement.revenueCents,
    data.incomeStatement.operatingExpensesCents,
    data.comparison?.revenueCents ?? 0,
  ].some((value) => typeof value === "number" && value !== 0);

  return (
    <>
      <section aria-label="Contexto e ações do relatório" className="reports-result-toolbar">
        <div className="reports-result-toolbar__context">
          <div className="reports-result-toolbar__context-copy">
            <strong>{periodLabel(data.period)}</strong>
            <span className="gm-pill" data-tone="info">
              Fuso: {data.timezone ?? "não informado"}
            </span>
          </div>
          {onRefresh && (
            <Button onClick={onRefresh} size="sm" variant="ghost">
              <Icon name="refresh" size={14} />
              Recarregar
            </Button>
          )}
        </div>
        <div className="reports-result-toolbar__actions">
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
                  setActiveAnalysis(defaultReportAnalysis(query.family));
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
            {scope && (
              <ReportActionCenter
                data={data}
                onApply={(query) => {
                  setActiveFamily(query.family);
                  setActiveAnalysis(defaultReportAnalysis(query.family));
                  onApplyFilters?.({
                    period: { from: query.from, to: query.to },
                    comparisonMode: query.comparisonMode,
                  });
                }}
                scope={scope}
              />
            )}
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

      <ReportFamilyNavigation
        active={activeFamily}
        activeAnalysis={activeAnalysis}
        onAnalysisChange={setActiveAnalysis}
        onChange={setActiveFamily}
        storageKey={`gm:reports:families:${scope?.organizationId ?? "preview"}:${scope?.unitId ?? "preview"}:${scope?.profileId ?? "preview"}`}
        viewCosts={data.capabilities.viewCosts}
      />

      {activeFamily === "overview" && !hasMovement && (
        <Callout tone="info">
          <strong>Período sem movimentação</strong>
          <span>
            Não há recebimentos, pagamentos ou lançamentos por competência entre{" "}
            {periodLabel(data.period)}.
          </span>
          {scope && (
            <a className="gm-button gm-button--secondary gm-button--sm" href={routeHref("counter")}>
              Abrir atendimento
            </a>
          )}
        </Callout>
      )}

      {activeFamily === "overview" && (
        <>
          {activeAnalysis === "overview-managerial" && (
            <div className="metrics-grid reports-metrics">
              <Card className="metric-card">
                <p>Receita por competência</p>
                <strong>{formatMoney(data.incomeStatement.revenueCents)}</strong>
                <small>Receita confirmada no período</small>
                {data.comparison && data.comparison.mode !== "none" && (
                  <span
                    className="gm-pill reports-kpi-delta"
                    data-tone={
                      data.comparison.changeCents === null
                        ? "info"
                        : data.comparison.changeCents > 0
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
          )}

          {activeAnalysis === "overview-managerial" &&
            data.capabilities.viewCosts &&
            !data.incomeStatement.costCoverage.completeForRevenue && (
              <Callout tone="warning">
                <strong>Margem ainda não calculável</strong>
                <span>
                  Existem custos ausentes no período. O GiroMesa preserva CMV, margem e resultado
                  como indisponíveis para não exibir lucro incorreto.
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

          {activeAnalysis === "overview-managerial" &&
            scope &&
            data.capabilities.backfillCosts &&
            !data.incomeStatement.costCoverage.completeForRevenue && (
              <ReportCostBackfill data={data} onRefresh={onRefresh} scope={scope} />
            )}

          {activeAnalysis === "overview-managerial" && <BudgetSummary budget={data.budget} />}
          {activeAnalysis === "overview-managerial" && (
            <DailyRevenueChart data={data} scope={scope} />
          )}
          {(activeAnalysis === "overview-managerial" || activeAnalysis === "overview-sales") && (
            <Breakdowns
              data={data}
              onDrillDown={setDrillDownTarget}
              order={breakdownOrder}
              scope={scope}
            />
          )}
          {(activeAnalysis === "overview-managerial" ||
            activeAnalysis === "overview-cash" ||
            activeAnalysis === "overview-income") && (
            <FinancialStatements
              data={data}
              section={
                activeAnalysis === "overview-cash"
                  ? "cash"
                  : activeAnalysis === "overview-income"
                    ? "income"
                    : "all"
              }
              viewCosts={data.capabilities.viewCosts}
            />
          )}
          {activeAnalysis === "overview-managerial" && scope && data.capabilities.manageBudget && (
            <BudgetManager scope={scope} />
          )}
          {activeAnalysis === "overview-managerial" &&
            scope &&
            data.capabilities.manageSchedules && (
              <ScheduleManager
                emailDeliveryConfigured={data.capabilities.emailDeliveryConfigured}
                scope={scope}
              />
            )}
        </>
      )}
      {activeFamily !== "overview" && (
        <ReportFamilyView
          analysis={activeAnalysis}
          breakdownOrder={breakdownOrder}
          family={activeFamily}
          data={data}
          onDrillDown={setDrillDownTarget}
          onRefresh={onRefresh}
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

function FinancialStatements({
  data,
  section = "all",
  viewCosts,
}: {
  data: ReportData;
  section?: "all" | "cash" | "income";
  viewCosts: boolean;
}) {
  const { cashFlow, incomeStatement } = data;
  return (
    <div className="quick-actions-grid reports-statements">
      {section !== "income" && (
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
      )}

      {section !== "cash" && viewCosts && (
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

const indicatorLabels: Record<string, string> = {
  revenue: "Receita",
  cashFlow: "Fluxo de caixa",
  profitability: "Rentabilidade",
  inventory: "Estoque",
  labor: "Mão de obra",
  reconciliation: "Conciliação",
  forecast: "Previsão",
  budget: "Orçamento",
};

const reportSourceLabels: Record<string, string> = {
  pos_tabs: "Contas do atendimento",
  pos_tab_payments: "Pagamentos das contas",
  pos_order_items: "Itens vendidos",
  management_receivable_payments: "Recebimentos financeiros",
  management_payable_payments: "Pagamentos financeiros",
  management_receivable_lines: "Lançamentos financeiros",
  management_inventory_events: "Movimentos de estoque",
  management_stock_balances: "Saldos de estoque",
  management_time_entries: "Registros de ponto",
  management_schedules: "Escalas da equipe",
  fiscal_documents: "Documentos fiscais",
  management_reconciliation_entries: "Itens de conciliação",
  management_report_budgets: "Orçamentos",
};

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Não foi possível concluir a ação.";
  const requestId = error instanceof ApiClientError ? error.requestId : undefined;
  return requestId ? `${message} Referência: ${requestId}.` : message;
}

function ReportFreshness({ data }: { data: ReportData }) {
  if (!data.meta) return null;
  const { meta } = data;
  const sourceTotal = Object.values(meta.sourceCounts).reduce((sum, count) => sum + count, 0);
  const indicators = Object.entries(meta.indicators);
  const sourceLabel =
    sourceTotal === 0
      ? "Nenhum registro-fonte no período"
      : `${sourceTotal} ${sourceTotal === 1 ? "registro-fonte" : "registros-fonte"}`;
  const dataThroughLabel = meta.dataThrough
    ? `Dados até ${formatTimestamp(meta.dataThrough, data.timezone)}`
    : "Corte dos dados não informado";
  return (
    <Card className="reports-freshness grid" aria-label="Atualização e cobertura dos dados">
      <div>
        <strong>Atualizado {formatTimestamp(meta.generatedAt, data.timezone)}</strong>
        <span className="reports-freshness__detail">
          {dataThroughLabel} · {sourceLabel}
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
      {indicators.length > 0 && (
        <details className="reports-indicator-health">
          <summary>Saúde por indicador ({indicators.length})</summary>
          <dl>
            {indicators.map(([key, indicator]) => (
              <div key={key}>
                <dt>{indicatorLabels[key] ?? key}</dt>
                <dd>
                  <span
                    className="gm-pill"
                    data-tone={
                      indicator.coverage === "complete"
                        ? "positive"
                        : indicator.coverage === "partial"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {coverageLabel(indicator.coverage)}
                  </span>{" "}
                  <span>
                    Até {formatTimestamp(indicator.dataThrough, data.timezone)} ·{" "}
                    {indicator.sources.length
                      ? indicator.sources
                          .map((source) => reportSourceLabels[source] ?? source)
                          .join(", ")
                      : "sem fonte disponível"}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
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
