import { Badge, Card, EmptyState, VisuallyHidden } from "@giromesa/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import type { Profile } from "../../domain";
import {
  type ManagementScope,
  type OverviewData,
  type OverviewSourceId,
  parseOverview,
  RemoteGate,
  useRemote,
} from "../../management.shared";
import { routeHref } from "../../router";
import { canAccess } from "../../rules";

export function RealDashboard({
  profile,
  scope,
  unitName,
}: {
  profile: Profile;
  scope: ManagementScope;
  unitName: string;
}) {
  const { organizationId, unitId } = scope;
  const loader = useCallback(
    () => api.management.overview(organizationId, unitId),
    [organizationId, unitId],
  );
  const remote = useRemote(scope, loader, parseOverview);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [alertDigest, setAlertDigest] = useState<string | null>(null);
  const visited = useRef(false);
  const visitedScope = useRef("");
  const seenPriorities = useRef<Set<string> | null>(null);
  const lastDigestAt = useRef(0);
  const data = remote.state.status === "ready" ? remote.state.data : null;

  useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState === "visible") remote.retry();
    };
    const timer = window.setInterval(refreshVisible, 60_000);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [remote.retry]);

  useEffect(() => {
    const nextScope = `${organizationId}:${unitId}`;
    if (visitedScope.current !== nextScope) {
      visitedScope.current = nextScope;
      visited.current = false;
      seenPriorities.current = null;
    }
  }, [organizationId, unitId]);

  useEffect(() => {
    if (!data || visited.current) return;
    visited.current = true;
    void api.management.markOverviewVisited(organizationId, unitId).catch(() => undefined);
  }, [data, organizationId, unitId]);

  useEffect(() => {
    if (!data) return;
    const eligible = data.priorities.filter(
      ({ tone }) => toneWeight(tone) >= toneWeight(data.preferences.minimumTone),
    );
    const current = new Set(eligible.map(({ occurrenceKey }) => occurrenceKey));
    if (seenPriorities.current === null) {
      seenPriorities.current = current;
      return;
    }
    const added = eligible.filter(
      ({ occurrenceKey }) => !seenPriorities.current?.has(occurrenceKey),
    );
    seenPriorities.current = current;
    if (
      data.preferences.alertsEnabled &&
      added.length > 0 &&
      Date.now() - lastDigestAt.current >= data.preferences.digestMinutes * 60_000
    ) {
      lastDigestAt.current = Date.now();
      setAlertDigest(`${added.length} nova(s) prioridade(s) operacional(is).`);
    }
  }, [data]);

  async function actOnPriority(
    priority: OverviewData["priorities"][number],
    action: "claim" | "snooze" | "resolve",
  ) {
    setBusyAction(`${priority.id}:${action}`);
    setActionError(null);
    try {
      await api.management.overviewPriorityAction(organizationId, unitId, priority.id, {
        occurrenceKey: priority.occurrenceKey,
        action,
        ...(action === "snooze" ? { snoozeMinutes: 15 } : {}),
      });
      remote.retry();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Não foi possível atualizar a prioridade.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function retrySource(source: OverviewSourceId) {
    setBusyAction(`source:${source}`);
    setActionError(null);
    try {
      const patch = parseOverview(await api.management.overview(organizationId, unitId, source));
      remote.update((current) => mergeOverviewSource(current, patch, source));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "A fonte continua indisponível.");
    } finally {
      setBusyAction(null);
    }
  }

  async function savePreferences(preferences: OverviewData["preferences"]) {
    setBusyAction("preferences");
    setActionError(null);
    try {
      await api.management.updateOverviewPreferences(organizationId, unitId, preferences);
      remote.update((current) => ({ ...current, preferences }));
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Não foi possível salvar as preferências.",
      );
      throw error;
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <RemoteGate remote={remote}>
      {(overview) => {
        const metrics = overview.metrics
          .filter((item) => canAccess(profile, item.route))
          .slice(0, 4);
        const priorities = overview.priorities
          .filter((item) => canAccess(profile, item.route))
          .sort((left, right) => toneWeight(right.tone) - toneWeight(left.tone))
          .slice(0, 5);
        const pulse = overview.pulse
          .filter((item) => !item.route || canAccess(profile, item.route))
          .slice(0, 6);
        const quickActions = overview.quickActions
          .filter((item) => canAccess(profile, item.route))
          .slice(0, 3);
        const activity = overview.activity.filter(
          (item) => !item.route || canAccess(profile, item.route),
        );
        return (
          <div className="dashboard-overview">
            <section aria-label="Contexto da visão geral" className="dashboard-context">
              <div className="dashboard-context__scope">
                <Badge tone="info">{profile.role}</Badge>
                <strong>{unitName}</strong>
                <span>
                  {overview.activeShift
                    ? `${overview.activeShift.label} · iniciado ${relativeStart(overview.activeShift.startsAt)}`
                    : operationalProfile(overview.profileId)
                      ? "Sem turno operacional aberto"
                      : "Visão gerencial da unidade"}
                </span>
              </div>
              <time dateTime={overview.generatedAt}>
                Atualizado às {time(overview.generatedAt)}
              </time>
            </section>

            <p aria-live="polite" className="dashboard-live-update" role="status">
              {alertDigest}
            </p>

            {(overview.unavailableSources.length > 0 || actionError) && (
              <Card className="dashboard-partial" role="alert">
                <div>
                  <strong>
                    {actionError ? "Ação não concluída" : "Dados parcialmente atualizados"}
                  </strong>
                  <span>
                    {actionError ??
                      "As demais fontes continuam disponíveis. Tente novamente somente a fonte necessária."}
                  </span>
                </div>
                {!actionError && (
                  <div className="dashboard-source-retries">
                    {overview.unavailableSources.map((source) => (
                      <button
                        disabled={busyAction === `source:${source}`}
                        key={source}
                        onClick={() => void retrySource(source as OverviewSourceId)}
                        type="button"
                      >
                        {busyAction === `source:${source}`
                          ? "Consultando…"
                          : `Tentar ${sourceLabel(source)}`}
                      </button>
                    ))}
                  </div>
                )}
              </Card>
            )}

            <Card className="dashboard-priorities">
              <div className="card-header">
                <div>
                  <p className="eyebrow">Prioridades</p>
                  <h2>Faça agora</h2>
                </div>
                <Badge
                  tone={
                    priorities.length || overview.unavailableSources.length ? "warning" : "success"
                  }
                >
                  {priorities.length
                    ? `${priorities.length} pendência(s)`
                    : overview.unavailableSources.length
                      ? "Dados parciais"
                      : "Tudo em dia"}
                </Badge>
              </div>
              {priorities.length ? (
                <div className="dashboard-priority-list">
                  {priorities.map((item) => (
                    <article
                      className="dashboard-priority"
                      key={`${item.id}:${item.occurrenceKey}`}
                    >
                      <span
                        aria-label={toneLabel(item.tone)}
                        className={`dashboard-status dashboard-status--${item.tone}`}
                        role="img"
                      />
                      <a className="dashboard-priority__main" href={routeHref(item.route)}>
                        <strong>{item.title}</strong>
                        <small>{item.detail}</small>
                        {item.assignedTo && (
                          <span className="dashboard-priority__owner">
                            {item.assignedTo.isMe
                              ? "Assumida por você"
                              : `Com ${item.assignedTo.name}`}
                          </span>
                        )}
                      </a>
                      <div className="dashboard-priority__controls">
                        <a href={routeHref(item.route)}>{item.actionLabel} →</a>
                        <button
                          disabled={busyAction !== null || item.assignedTo?.isMe}
                          onClick={() => void actOnPriority(item, "claim")}
                          type="button"
                        >
                          Assumir
                        </button>
                        <button
                          disabled={busyAction !== null}
                          onClick={() => void actOnPriority(item, "snooze")}
                          type="button"
                        >
                          Adiar 15 min
                        </button>
                        <button
                          disabled={busyAction !== null}
                          onClick={() => void actOnPriority(item, "resolve")}
                          type="button"
                        >
                          Marcar tratada
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  description={
                    overview.unavailableSources.length
                      ? "Parte das fontes não respondeu. Atualize a fonte antes de concluir que não há pendências."
                      : "Nenhuma exceção exige ação neste momento."
                  }
                  icon={overview.unavailableSources.length ? "!" : "✓"}
                  title={
                    overview.unavailableSources.length
                      ? "Sem prioridades confirmadas"
                      : "Operação em dia"
                  }
                />
              )}
            </Card>

            {metrics.length ? (
              <section aria-label="Indicadores principais" className="dashboard-metrics">
                {metrics.map((metric) => (
                  <a
                    className={`dashboard-metric dashboard-metric--${metric.tone}`}
                    href={routeHref(metric.route)}
                    key={metric.id}
                  >
                    <Card>
                      <span className="dashboard-metric__label">{metric.label}</span>
                      <strong>{metric.value}</strong>
                      <small>{metric.detail}</small>
                      {(metric.comparison || metric.goal) && (
                        <span className="dashboard-metric__context">
                          {metric.comparison && (
                            <Badge tone={metric.comparison.tone}>
                              {metric.comparison.value} · {metric.comparison.label}
                            </Badge>
                          )}
                          {metric.goal && (
                            <Badge tone={metric.goal.tone}>{metric.goal.label}</Badge>
                          )}
                        </span>
                      )}
                      <span aria-hidden="true" className="dashboard-metric__arrow">
                        →
                      </span>
                      <VisuallyHidden>Abrir {metric.label}</VisuallyHidden>
                    </Card>
                  </a>
                ))}
              </section>
            ) : (
              <Card>
                <EmptyState
                  description="Não há indicadores disponíveis para este perfil neste momento."
                  icon="i"
                  title="Sem indicadores"
                />
              </Card>
            )}

            {overview.multiunit.length > 0 && (
              <Card className="dashboard-multiunit">
                <div className="card-header">
                  <div>
                    <p className="eyebrow">Multiunidade</p>
                    <h2>Onde agir primeiro</h2>
                  </div>
                  <a href={routeHref("multiunit")}>Comparar tudo →</a>
                </div>
                <div className="dashboard-unit-ranking">
                  {overview.multiunit.map((unit, index) => (
                    <a href={routeHref("multiunit")} key={unit.unitId}>
                      <span>{index + 1}</span>
                      <strong>{unit.name}</strong>
                      <small>
                        {money(unit.salesCents)} · margem{" "}
                        {unit.marginCents === null ? "sem cobertura" : money(unit.marginCents)}
                      </small>
                      <Badge tone={unit.tone}>
                        {unit.alerts ? `${unit.alerts} alerta(s)` : "Normal"}
                      </Badge>
                    </a>
                  ))}
                </div>
              </Card>
            )}

            <div className="dashboard-secondary">
              <Card className="dashboard-pulse">
                <div className="card-header">
                  <div>
                    <p className="eyebrow">Operação ao vivo</p>
                    <h2>Pulso do turno</h2>
                  </div>
                  <Badge tone={overview.activeShift ? "success" : "neutral"}>
                    {overview.activeShift ? "Turno aberto" : "Sem turno"}
                  </Badge>
                </div>
                {pulse.length ? (
                  <div className="dashboard-pulse__grid">
                    {pulse.map((item) => {
                      const content = (
                        <>
                          <span>{item.label}</span>
                          <strong>{item.value}</strong>
                        </>
                      );
                      return item.route ? (
                        <a href={routeHref(item.route)} key={item.id}>
                          {content}
                        </a>
                      ) : (
                        <div key={item.id}>{content}</div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="dashboard-muted">Sem atividade registrada no turno atual.</p>
                )}
              </Card>
              <Card className="dashboard-quick-actions">
                <div className="card-header">
                  <div>
                    <p className="eyebrow">Atalhos</p>
                    <h2>Próximas ações</h2>
                  </div>
                </div>
                {quickActions.length ? (
                  <div className="dashboard-quick-actions__list">
                    {quickActions.map((action) => (
                      <a href={routeHref(action.route)} key={action.id}>
                        <span>{action.label}</span>
                        <span aria-hidden="true">→</span>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="dashboard-muted">Use o menu para acessar seus módulos.</p>
                )}
              </Card>
              <Card className="dashboard-activity">
                <div className="card-header">
                  <div>
                    <p className="eyebrow">Desde sua última visita</p>
                    <h2>O que mudou</h2>
                  </div>
                  <Badge tone="info">{activity.length}</Badge>
                </div>
                {activity.length ? (
                  <div className="dashboard-activity__list">
                    {activity.map((item) => {
                      const content = (
                        <>
                          <strong>{item.label}</strong>
                          <small>
                            {item.detail} · {relativeTime(item.occurredAt)}
                          </small>
                        </>
                      );
                      return item.route ? (
                        <a href={routeHref(item.route)} key={item.id}>
                          {content}
                        </a>
                      ) : (
                        <div key={item.id}>{content}</div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="dashboard-muted">
                    Nenhuma mudança relevante desde a última visita.
                  </p>
                )}
              </Card>
              <Card className="dashboard-freshness">
                <div className="card-header">
                  <div>
                    <p className="eyebrow">Qualidade dos dados</p>
                    <h2>Fontes consultadas</h2>
                  </div>
                </div>
                <div className="dashboard-source-list">
                  {overview.sources.map((source) => (
                    <div key={source.id}>
                      <span>
                        <i
                          className={`dashboard-source-dot dashboard-source-dot--${source.status}`}
                        />
                        {sourceLabel(source.id)}
                      </span>
                      <time dateTime={source.checkedAt}>{time(source.checkedAt)}</time>
                      {source.status === "unavailable" && (
                        <button
                          disabled={busyAction === `source:${source.id}`}
                          onClick={() => void retrySource(source.id)}
                          type="button"
                        >
                          Tentar novamente
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <PreferencesForm
              busy={busyAction === "preferences"}
              onSave={savePreferences}
              value={overview.preferences}
            />
          </div>
        );
      }}
    </RemoteGate>
  );
}

function PreferencesForm({
  busy,
  onSave,
  value,
}: {
  busy: boolean;
  onSave: (value: OverviewData["preferences"]) => Promise<void>;
  value: OverviewData["preferences"];
}) {
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(false);
  const threshold = (key: keyof OverviewData["preferences"]["thresholds"], next: number) =>
    setDraft((current) => ({ ...current, thresholds: { ...current.thresholds, [key]: next } }));
  return (
    <details className="dashboard-preferences">
      <summary>Configurar metas e alertas</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setSaved(false);
          void onSave(draft)
            .then(() => setSaved(true))
            .catch(() => undefined);
        }}
      >
        <label className="dashboard-check">
          <input
            checked={draft.alertsEnabled}
            onChange={(event) =>
              setDraft((current) => ({ ...current, alertsEnabled: event.target.checked }))
            }
            type="checkbox"
          />
          Alertas dentro do sistema
        </label>
        <label>
          Severidade mínima
          <select
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                minimumTone: event.target.value as OverviewData["preferences"]["minimumTone"],
              }))
            }
            value={draft.minimumTone}
          >
            <option value="info">Informativa</option>
            <option value="warning">Atenção</option>
            <option value="danger">Crítica</option>
          </select>
        </label>
        <NumberField
          label="Agrupar por"
          max={1440}
          min={5}
          onChange={(next) => setDraft((current) => ({ ...current, digestMinutes: next }))}
          suffix="min"
          value={draft.digestMinutes}
        />
        <NumberField
          label="Atraso KDS"
          max={120}
          min={5}
          onChange={(next) => threshold("kdsDelayMinutes", next)}
          suffix="min"
          value={draft.thresholds.kdsDelayMinutes}
        />
        <NumberField
          label="Cobertura de estoque"
          max={60}
          min={1}
          onChange={(next) => threshold("stockCoverageDays", next)}
          suffix="dias"
          value={draft.thresholds.stockCoverageDays}
        />
        <NumberField
          label="Risco de delivery"
          max={120}
          min={0}
          onChange={(next) => threshold("deliveryRiskMinutes", next)}
          suffix="min"
          value={draft.thresholds.deliveryRiskMinutes}
        />
        <label>
          Meta de vendas
          <input
            min="0"
            max="1000000"
            onChange={(event) =>
              threshold("salesGoalCents", Math.round(Number(event.target.value) * 100))
            }
            step="0.01"
            type="number"
            value={(draft.thresholds.salesGoalCents / 100).toFixed(2)}
          />
          <span>R$</span>
        </label>
        <NumberField
          label="Máx. KDS atrasados"
          max={1000}
          min={0}
          onChange={(next) => threshold("maxKdsDelayed", next)}
          value={draft.thresholds.maxKdsDelayed}
        />
        <NumberField
          label="Máx. rupturas"
          max={1000}
          min={0}
          onChange={(next) => threshold("maxStockouts", next)}
          value={draft.thresholds.maxStockouts}
        />
        <NumberField
          label="Máx. deliveries atrasados"
          max={1000}
          min={0}
          onChange={(next) => threshold("maxDeliveryDelayed", next)}
          value={draft.thresholds.maxDeliveryDelayed}
        />
        <NumberField
          label="Máx. conciliações"
          max={10000}
          min={0}
          onChange={(next) => threshold("maxReconciliations", next)}
          value={draft.thresholds.maxReconciliations}
        />
        <button disabled={busy} type="submit">
          {busy ? "Salvando…" : "Salvar preferências"}
        </button>
        {saved && <span role="status">Preferências salvas.</span>}
      </form>
    </details>
  );
}

function NumberField({
  label,
  max,
  min,
  onChange,
  suffix,
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  suffix?: string;
  value: number;
}) {
  return (
    <label>
      {label}
      <input
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        type="number"
        value={value}
      />
      {suffix && <span>{suffix}</span>}
    </label>
  );
}

function mergeOverviewSource(current: OverviewData, patch: OverviewData, source: OverviewSourceId) {
  const replace = <T extends { source: OverviewSourceId }>(before: T[], after: T[]) => [
    ...before.filter((item) => item.source !== source),
    ...after.filter((item) => item.source === source),
  ];
  const sources = [
    ...current.sources.filter((item) => item.id !== source),
    ...patch.sources.filter((item) => item.id === source),
  ];
  return {
    ...current,
    generatedAt: patch.generatedAt,
    activeShift: source === "operationalShift" ? patch.activeShift : current.activeShift,
    metrics: replace(current.metrics, patch.metrics),
    priorities: replace(current.priorities, patch.priorities),
    pulse: replace(current.pulse, patch.pulse),
    sources,
    unavailableSources: sources
      .filter(({ status }) => status === "unavailable")
      .map(({ id }) => id),
    activity: source === "activity" ? patch.activity : current.activity,
    multiunit: source === "multiunit" ? patch.multiunit : current.multiunit,
    partialSource: null,
  };
}

function time(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "horário indisponível"
    : new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
}
function relativeTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "horário indisponível";
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `há ${hours} h` : `há ${Math.floor(hours / 24)} dia(s)`;
}
function relativeStart(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "em horário indisponível";
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `há ${hours}h${minutes % 60 ? ` ${minutes % 60}min` : ""}`;
}
function money(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}
function toneLabel(tone: string) {
  if (tone === "danger") return "Crítico";
  if (tone === "warning") return "Atenção";
  if (tone === "success") return "Normal";
  if (tone === "info") return "Informativo";
  return "Neutro";
}
function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    cash: "caixa",
    delivery: "delivery",
    finance: "financeiro",
    inventory: "estoque",
    operations: "operação",
    operationalShift: "turno operacional",
    tableTurnover: "giro de mesas",
    reservations: "reservas",
    activity: "atividades",
    multiunit: "multiunidade",
  };
  return labels[source] ?? source;
}
function operationalProfile(profileId: string) {
  return [
    "owner",
    "manager",
    "waiter",
    "cashier",
    "receptionist",
    "busser",
    "kitchen",
    "delivery",
  ].includes(profileId);
}
function toneWeight(tone: string) {
  if (tone === "danger") return 4;
  if (tone === "warning") return 3;
  if (tone === "info") return 2;
  if (tone === "success") return 1;
  return 0;
}
