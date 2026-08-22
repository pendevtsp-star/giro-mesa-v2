import { Button, Card, Input, NativeSelect } from "@giromesa/ui";
import { useEffect, useState } from "react";
import {
  analysesForFamily,
  defaultReportAnalysis,
  type ReportAnalysisId,
  type ReportViewMode,
  reportAnalyses,
  reportAnalysis,
  reportAnalysisLabel,
  reportAnalysisMode,
} from "./report-analysis";

export type ReportFamilyId =
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

export const reportFamilyGroups: Array<{
  label: string;
  items: Array<{ id: ReportFamilyId; label: string }>;
}> = [
  {
    label: "Financeiro",
    items: [
      { id: "overview", label: "Visão geral" },
      { id: "profitability", label: "Rentabilidade" },
      { id: "reconciliation", label: "Fiscal e pagamentos" },
      { id: "forecast", label: "Previsão" },
    ],
  },
  {
    label: "Vendas",
    items: [
      { id: "sales", label: "Vendas" },
      { id: "exceptions", label: "Descontos e cancelamentos" },
    ],
  },
  {
    label: "Operação",
    items: [
      { id: "operations", label: "Operação" },
      { id: "labor", label: "Mão de obra" },
      { id: "inventory", label: "Estoque" },
      { id: "purchasing", label: "Compras" },
    ],
  },
  {
    label: "Gestão",
    items: [
      { id: "multiunit", label: "Multiunidade" },
      { id: "quality", label: "Qualidade dos dados" },
    ],
  },
];

export const reportFamilyTabs = reportFamilyGroups.flatMap((group) => group.items);

export function reportFamily(value: string | null): ReportFamilyId {
  return reportFamilyTabs.some((item) => item.id === value)
    ? (value as ReportFamilyId)
    : "overview";
}

export function reportFamilyLabel(id: ReportFamilyId): string {
  return reportFamilyTabs.find((item) => item.id === id)?.label ?? "Relatório";
}

function parseAnalysisIds(value: string | null): ReportAnalysisId[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const valid = new Set(reportAnalyses.map((analysis) => analysis.id));
    return [...new Set(parsed.filter((item): item is ReportAnalysisId => valid.has(item)))];
  } catch {
    return [];
  }
}

function loadAnalysisIds(key: string): ReportAnalysisId[] {
  if (typeof window === "undefined") return [];
  try {
    return parseAnalysisIds(window.localStorage.getItem(key));
  } catch {
    return [];
  }
}

const modeLabels: Record<ReportViewMode, string> = {
  simple: "Simples",
  analytical: "Analítico",
  managerial: "Gerencial",
};

export function ReportFamilyNavigation({
  active,
  activeAnalysis,
  onAnalysisChange,
  onChange,
  storageKey,
  viewCosts = true,
}: {
  active: ReportFamilyId;
  activeAnalysis: ReportAnalysisId;
  onAnalysisChange: (analysis: ReportAnalysisId) => void;
  onChange: (family: ReportFamilyId) => void;
  storageKey: string;
  viewCosts?: boolean;
}) {
  const favoritesKey = `${storageKey}:favorites`;
  const recentsKey = `${storageKey}:recents`;
  const [favorites, setFavorites] = useState<ReportAnalysisId[]>(() =>
    loadAnalysisIds(favoritesKey),
  );
  const [recents, setRecents] = useState<ReportAnalysisId[]>(() => loadAnalysisIds(recentsKey));
  const [query, setQuery] = useState("");
  const isAvailable = (analysis: (typeof reportAnalyses)[number]) =>
    viewCosts || analysis.id !== "overview-income";
  const familyAnalyses = analysesForFamily(active).filter(isAvailable);
  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
  const matches = normalizedQuery
    ? reportAnalyses.filter(
        (analysis) =>
          isAvailable(analysis) &&
          `${analysis.label} ${analysis.description}`
            .toLocaleLowerCase("pt-BR")
            .includes(normalizedQuery),
      )
    : [];

  useEffect(() => {
    setFavorites(loadAnalysisIds(favoritesKey));
    setRecents(loadAnalysisIds(recentsKey));
  }, [favoritesKey, recentsKey]);

  useEffect(() => {
    const next = [activeAnalysis, ...recents.filter((item) => item !== activeAnalysis)].slice(0, 5);
    if (next.join(":") === recents.join(":")) return;
    setRecents(next);
    try {
      window.localStorage.setItem(recentsKey, JSON.stringify(next));
    } catch {
      // Recentes são locais e nunca bloqueiam a navegação.
    }
  }, [activeAnalysis, recents, recentsKey]);

  function chooseAnalysis(next: ReportAnalysisId) {
    const family = reportAnalyses.find((analysis) => analysis.id === next)?.family ?? active;
    if (family !== active) onChange(family);
    onAnalysisChange(next);
    setQuery("");
  }

  function chooseFamily(next: ReportFamilyId) {
    onChange(next);
    onAnalysisChange(defaultReportAnalysis(next));
    setQuery("");
  }

  function chooseMode(mode: ReportViewMode) {
    const next = familyAnalyses.find((analysis) => analysis.mode === mode);
    if (next) onAnalysisChange(next.id);
  }

  function toggleFavorite() {
    const next = favorites.includes(activeAnalysis)
      ? favorites.filter((item) => item !== activeAnalysis)
      : [...favorites, activeAnalysis];
    setFavorites(next);
    try {
      window.localStorage.setItem(favoritesKey, JSON.stringify(next));
    } catch {
      // Favoritos continuam funcionais durante a sessão sem armazenamento local.
    }
  }

  const shortcuts = [...new Set([...favorites, ...recents])].slice(0, 6);

  return (
    <Card className="reports-family-navigation grid">
      <div className="reports-family-navigation__copy">
        <p className="eyebrow">Biblioteca de relatórios</p>
        <h2>Escolha a análise</h2>
        <p>Selecione primeiro a família e depois o recorte que deseja consultar.</p>
      </div>

      <div className="reports-family-navigation__controls">
        <label className="gm-field" htmlFor="reports-family-select">
          Família
          <NativeSelect
            aria-label="Escolher família de relatórios"
            className="gm-control"
            id="reports-family-select"
            onChange={(event) => chooseFamily(reportFamily(event.target.value))}
            value={active}
          >
            {reportFamilyGroups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </NativeSelect>
        </label>

        <label className="gm-field" htmlFor="reports-analysis-select">
          Tipo de relatório
          <NativeSelect
            aria-label="Escolher tipo de relatório"
            className="gm-control"
            id="reports-analysis-select"
            onChange={(event) => onAnalysisChange(reportAnalysis(event.target.value, active))}
            value={activeAnalysis}
          >
            {familyAnalyses.map((analysis) => (
              <option key={analysis.id} value={analysis.id}>
                {analysis.label}
              </option>
            ))}
          </NativeSelect>
        </label>

        <label className="gm-field" htmlFor="reports-model-select">
          Modelo
          <NativeSelect
            aria-label="Escolher modelo do relatório"
            className="gm-control"
            id="reports-model-select"
            onChange={(event) => chooseMode(event.target.value as ReportViewMode)}
            value={reportAnalysisMode(activeAnalysis)}
          >
            {(Object.keys(modeLabels) as ReportViewMode[]).map((mode) => (
              <option
                disabled={!familyAnalyses.some((analysis) => analysis.mode === mode)}
                key={mode}
                value={mode}
              >
                {modeLabels[mode]}
              </option>
            ))}
          </NativeSelect>
        </label>

        <label className="gm-field reports-analysis-search" htmlFor="reports-analysis-search">
          Buscar relatório
          <Input
            aria-controls="reports-analysis-search-results"
            className="gm-control"
            id="reports-analysis-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Produto, caixa, estoque..."
            type="search"
            value={query}
          />
        </label>
      </div>

      {normalizedQuery && (
        <div className="reports-analysis-search-results" id="reports-analysis-search-results">
          {matches.length ? (
            matches.map((analysis) => (
              <Button
                key={analysis.id}
                onClick={() => chooseAnalysis(analysis.id)}
                size="sm"
                type="button"
                variant="ghost"
              >
                <span>{analysis.label}</span>
                <small>
                  {reportFamilyLabel(analysis.family)} · {modeLabels[analysis.mode]}
                </small>
              </Button>
            ))
          ) : (
            <small role="status">Nenhum relatório disponível corresponde à busca.</small>
          )}
        </div>
      )}

      <p className="reports-active-analysis-description">
        {familyAnalyses.find((analysis) => analysis.id === activeAnalysis)?.description}
      </p>

      <fieldset className="gm-toolbar reports-family-shortcuts">
        <legend className="gm-sr-only">Relatórios favoritos e recentes</legend>
        {shortcuts.map((id) => (
          <Button
            aria-pressed={activeAnalysis === id}
            key={id}
            onClick={() => chooseAnalysis(id)}
            size="sm"
            type="button"
            variant={activeAnalysis === id ? "secondary" : "ghost"}
          >
            {favorites.includes(id) ? "★ " : ""}
            {reportAnalysisLabel(id)}
          </Button>
        ))}
        <Button
          aria-pressed={favorites.includes(activeAnalysis)}
          onClick={toggleFavorite}
          size="sm"
          type="button"
          variant="ghost"
        >
          {favorites.includes(activeAnalysis) ? "★ Remover favorito" : "☆ Favoritar atual"}
        </Button>
      </fieldset>
    </Card>
  );
}
