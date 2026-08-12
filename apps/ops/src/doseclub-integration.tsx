import { Badge, Button, EmptyState } from "@giromesa/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { UiIcon } from "./ui-icon";

type Row = Record<string, unknown>;
type DoseClubRemote =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: DoseClubOverview };

const runTriggers = ["scheduled", "manual", "retry"] as const;
const runStatuses = ["pending", "running", "completed", "failed"] as const;
const findingKinds = [
  "missing_mapping",
  "inactive_mapping",
  "invalid_inventory_dimension",
  "invalid_inventory_unit",
  "state_version_gap",
  "missing_reconcile_heartbeat",
] as const;
const findingStatuses = ["open", "resolved", "superseded"] as const;
const findingSeverities = ["warning", "critical"] as const;
const reconciliationStatuses = ["not_scanned", "healthy", "attention", "failed"] as const;

export class InvalidDoseClubPayloadError extends Error {
  constructor() {
    super("A API retornou a integração DoseClub em formato inesperado.");
    this.name = "InvalidDoseClubPayloadError";
  }
}

function record(value: unknown): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidDoseClubPayloadError();
  }
  return value as Row;
}

function exactRecord(value: unknown, keys: readonly string[]) {
  const result = record(value);
  if (Object.keys(result).some((key) => !keys.includes(key))) {
    throw new InvalidDoseClubPayloadError();
  }
  return result;
}

function records(value: unknown) {
  if (!Array.isArray(value)) throw new InvalidDoseClubPayloadError();
  return value.map(record);
}

function text(value: unknown) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidDoseClubPayloadError();
  }
  return value;
}

function nullableText(value: unknown) {
  return value === null ? null : text(value);
}

function dateText(value: unknown) {
  const result = text(value);
  if (Number.isNaN(Date.parse(result))) throw new InvalidDoseClubPayloadError();
  return result;
}

function nullableDate(value: unknown) {
  return value === null ? null : dateText(value);
}

function integer(value: unknown, minimum = 0) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    throw new InvalidDoseClubPayloadError();
  }
  return value;
}

function bool(value: unknown) {
  if (typeof value !== "boolean") throw new InvalidDoseClubPayloadError();
  return value;
}

function literal<T extends readonly string[]>(value: unknown, values: T): T[number] {
  const result = text(value);
  if (!values.includes(result)) throw new InvalidDoseClubPayloadError();
  return result as T[number];
}

export interface DoseClubRun {
  id: string;
  unitId: string;
  runDate: string;
  trigger: (typeof runTriggers)[number];
  status: (typeof runStatuses)[number];
  findingCount: number;
  failureCode: string | null;
  version: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function parseDoseClubRun(value: unknown): DoseClubRun {
  const run = exactRecord(value, [
    "id",
    "unitId",
    "runDate",
    "trigger",
    "status",
    "findingCount",
    "failureCode",
    "version",
    "startedAt",
    "completedAt",
    "createdAt",
    "updatedAt",
  ]);
  return {
    id: text(run.id),
    unitId: text(run.unitId),
    runDate: dateText(run.runDate),
    trigger: literal(run.trigger, runTriggers),
    status: literal(run.status, runStatuses),
    findingCount: integer(run.findingCount),
    failureCode: nullableText(run.failureCode),
    version: integer(run.version, 1),
    startedAt: nullableDate(run.startedAt),
    completedAt: nullableDate(run.completedAt),
    createdAt: dateText(run.createdAt),
    updatedAt: dateText(run.updatedAt),
  };
}

export interface DoseClubMapping {
  id: string;
  unitId: string;
  externalProductId: string;
  productId: string;
  productName: string;
  inventoryItemId: string;
  inventoryItemName: string;
  stockLocationId: string;
  stockLocationName: string;
  active: boolean;
  version: number;
  updatedAt: string;
}

function parseMapping(value: unknown): DoseClubMapping {
  const mapping = exactRecord(value, [
    "id",
    "unitId",
    "externalProductId",
    "productId",
    "productName",
    "inventoryItemId",
    "inventoryItemName",
    "stockLocationId",
    "stockLocationName",
    "active",
    "version",
    "updatedAt",
  ]);
  return {
    id: text(mapping.id),
    unitId: text(mapping.unitId),
    externalProductId: text(mapping.externalProductId),
    productId: text(mapping.productId),
    productName: text(mapping.productName),
    inventoryItemId: text(mapping.inventoryItemId),
    inventoryItemName: text(mapping.inventoryItemName),
    stockLocationId: text(mapping.stockLocationId),
    stockLocationName: text(mapping.stockLocationName),
    active: bool(mapping.active),
    version: integer(mapping.version, 1),
    updatedAt: dateText(mapping.updatedAt),
  };
}

export interface DoseClubFinding {
  id: string;
  unitId: string;
  kind: (typeof findingKinds)[number];
  status: (typeof findingStatuses)[number];
  severity: (typeof findingSeverities)[number];
  entityType: string;
  entityId: string;
  summary: string;
  evidence: Row;
  firstDetectedAt: string;
  lastDetectedAt: string;
  resolvedAt: string | null;
  version: number;
}

function parseFinding(value: unknown): DoseClubFinding {
  const finding = exactRecord(value, [
    "id",
    "unitId",
    "kind",
    "status",
    "severity",
    "entityType",
    "entityId",
    "summary",
    "evidence",
    "firstDetectedAt",
    "lastDetectedAt",
    "resolvedAt",
    "version",
  ]);
  return {
    id: text(finding.id),
    unitId: text(finding.unitId),
    kind: literal(finding.kind, findingKinds),
    status: literal(finding.status, findingStatuses),
    severity: literal(finding.severity, findingSeverities),
    entityType: text(finding.entityType),
    entityId: text(finding.entityId),
    summary: text(finding.summary),
    evidence: record(finding.evidence),
    firstDetectedAt: dateText(finding.firstDetectedAt),
    lastDetectedAt: dateText(finding.lastDetectedAt),
    resolvedAt: nullableDate(finding.resolvedAt),
    version: integer(finding.version, 1),
  };
}

export interface DoseClubOverview {
  integration: {
    provider: "doseclub";
    status: string;
    unitId: string;
    updatedAt: string;
  } | null;
  reconciliation: {
    status: (typeof reconciliationStatuses)[number];
    remoteHeartbeat: "partial";
    lastRun: DoseClubRun | null;
    openFindingCount: number;
  };
  mappings: DoseClubMapping[];
  findings: DoseClubFinding[];
  runs: DoseClubRun[];
}

export function parseDoseClubOverview(value: unknown): DoseClubOverview {
  const overview = exactRecord(value, [
    "integration",
    "reconciliation",
    "mappings",
    "findings",
    "runs",
  ]);
  const integration =
    overview.integration === null
      ? null
      : exactRecord(overview.integration, ["provider", "status", "unitId", "updatedAt"]);
  const reconciliation = exactRecord(overview.reconciliation, [
    "status",
    "remoteHeartbeat",
    "lastRun",
    "openFindingCount",
  ]);
  if (integration && integration.provider !== "doseclub") {
    throw new InvalidDoseClubPayloadError();
  }
  if (reconciliation.remoteHeartbeat !== "partial") {
    throw new InvalidDoseClubPayloadError();
  }
  return {
    integration: integration
      ? {
          provider: "doseclub",
          status: text(integration.status),
          unitId: text(integration.unitId),
          updatedAt: dateText(integration.updatedAt),
        }
      : null,
    reconciliation: {
      status: literal(reconciliation.status, reconciliationStatuses),
      remoteHeartbeat: "partial",
      lastRun: reconciliation.lastRun === null ? null : parseDoseClubRun(reconciliation.lastRun),
      openFindingCount: integer(reconciliation.openFindingCount),
    },
    mappings: records(overview.mappings).map(parseMapping),
    findings: records(overview.findings).map(parseFinding),
    runs: records(overview.runs).map(parseDoseClubRun),
  };
}

export function assertDoseClubUnit(overview: DoseClubOverview, unitId: string) {
  const scopedRows = [
    ...(overview.integration ? [overview.integration] : []),
    ...(overview.reconciliation.lastRun ? [overview.reconciliation.lastRun] : []),
    ...overview.mappings,
    ...overview.findings,
    ...overview.runs,
  ];
  if (scopedRows.some((row) => row.unitId !== unitId)) {
    throw new InvalidDoseClubPayloadError();
  }
  return overview;
}

function dateTime(value: string | null) {
  if (!value) return "Não concluída";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function integrationStatusLabel(status: string | undefined) {
  if (!status) return "Não configurada";
  return (
    {
      active: "Ativa",
      disabled: "Desativada",
      error: "Com falha",
    }[status] ?? status
  );
}

function reconciliationLabel(status: DoseClubOverview["reconciliation"]["status"]) {
  return {
    not_scanned: "Ainda não verificada",
    healthy: "Sem divergências abertas",
    attention: "Requer atenção",
    failed: "Verificação falhou",
  }[status];
}

function runLabel(status: DoseClubRun["status"]) {
  return {
    pending: "Aguardando processamento",
    running: "Em processamento",
    completed: "Concluída",
    failed: "Falhou",
  }[status];
}

function findingLabel(kind: DoseClubFinding["kind"]) {
  return {
    missing_mapping: "Mapeamento ausente",
    inactive_mapping: "Mapeamento inativo",
    invalid_inventory_dimension: "Dimensão incompatível",
    invalid_inventory_unit: "Unidade incompatível",
    state_version_gap: "Lacuna de versão",
    missing_reconcile_heartbeat: "Heartbeat não confirmado",
  }[kind];
}

export interface DoseClubIntegrationScope {
  organizationId: string;
  unitId: string;
  refreshToken: number;
}

export function DoseClubIntegrationPanel({ scope }: { scope: DoseClubIntegrationScope }) {
  const [remote, setRemote] = useState<DoseClubRemote>({ status: "loading" });
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState<
    { tone: "success" | "warning" | "error"; message: string } | undefined
  >();
  const requestEpoch = useRef(0);

  const load = useCallback(
    async (showLoading: boolean) => {
      const epoch = ++requestEpoch.current;
      if (showLoading) setRemote({ status: "loading" });
      try {
        const data = assertDoseClubUnit(
          parseDoseClubOverview(
            await api.growth.doseClubOverview(scope.organizationId, scope.unitId),
          ),
          scope.unitId,
        );
        if (epoch === requestEpoch.current) setRemote({ status: "ready", data });
        return data;
      } catch (error) {
        if (epoch === requestEpoch.current) {
          setRemote({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Não foi possível carregar a integração DoseClub.",
          });
        }
        throw error;
      }
    },
    [scope.organizationId, scope.unitId],
  );

  useEffect(() => {
    void scope.refreshToken;
    void load(true).catch(() => undefined);
    return () => {
      requestEpoch.current += 1;
    };
  }, [load, scope.refreshToken]);

  async function runAction(actionKey: string, action: () => Promise<unknown>) {
    setBusy(actionKey);
    setFeedback(undefined);
    try {
      const acceptedRun = parseDoseClubRun(await action());
      const refreshed = await load(false);
      if (refreshed.runs.some((run) => run.id === acceptedRun.id)) {
        setFeedback({
          tone: "success",
          message: `Execução ${acceptedRun.id} confirmada no histórico persistido.`,
        });
      } else {
        setFeedback({
          tone: "warning",
          message:
            "A API aceitou a solicitação, mas a execução ainda não apareceu na leitura confirmatória. Atualize antes de repetir.",
        });
      }
    } catch (error) {
      setFeedback({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Não foi possível solicitar a verificação.",
      });
    } finally {
      setBusy("");
    }
  }

  if (remote.status === "loading") {
    return (
      <section aria-labelledby="doseclub-title" className="doseclub-panel">
        <div className="doseclub-panel__heading">
          <div>
            <h2 id="doseclub-title">DoseClub e estoque físico</h2>
            <p>Carregando configuração e verificações persistidas.</p>
          </div>
        </div>
        <div className="remote-state" role="status">
          <span aria-hidden="true" className="spinner" />
          <strong>Consultando integração…</strong>
        </div>
      </section>
    );
  }

  if (remote.status === "error") {
    return (
      <section aria-labelledby="doseclub-title" className="doseclub-panel">
        <div className="doseclub-panel__heading">
          <div>
            <h2 id="doseclub-title">DoseClub e estoque físico</h2>
            <p>A leitura falhou sem substituir o estado por dados demonstrativos.</p>
          </div>
        </div>
        <div className="remote-state" role="alert">
          <strong>Não foi possível carregar a integração</strong>
          <p>{remote.message}</p>
          <Button
            onClick={() => void load(true).catch(() => undefined)}
            size="sm"
            variant="secondary"
          >
            Tentar novamente
          </Button>
        </div>
      </section>
    );
  }

  const overview = remote.data;
  const lastRun = overview.reconciliation.lastRun;
  const isVerifying = lastRun?.status === "pending" || lastRun?.status === "running";

  return (
    <section aria-labelledby="doseclub-title" className="doseclub-panel">
      <div className="doseclub-panel__heading">
        <div>
          <h2 id="doseclub-title">DoseClub e estoque físico</h2>
          <p>
            O GiroMesa continua sendo a autoridade do estoque. Esta leitura mostra somente dados
            confirmados pelo servidor nesta unidade.
          </p>
        </div>
        <div className="doseclub-panel__status">
          <Badge
            tone={
              overview.reconciliation.status === "healthy"
                ? "success"
                : overview.reconciliation.status === "attention"
                  ? "warning"
                  : overview.reconciliation.status === "failed"
                    ? "danger"
                    : "neutral"
            }
          >
            {reconciliationLabel(overview.reconciliation.status)}
          </Badge>
          <Button
            aria-busy={busy === "run"}
            disabled={busy !== "" || isVerifying}
            onClick={() =>
              void runAction("run", () =>
                api.growth.startDoseClubRun(scope.organizationId, scope.unitId),
              )
            }
            size="sm"
          >
            {lastRun ? "Reexecutar verificação" : "Executar verificação"}
          </Button>
        </div>
      </div>

      {feedback && (
        <p
          className={`doseclub-feedback doseclub-feedback--${feedback.tone}`}
          role={feedback.tone === "error" ? "alert" : "status"}
        >
          {feedback.message}
        </p>
      )}

      <dl className="doseclub-summary">
        <div>
          <dt>Integração</dt>
          <dd>{integrationStatusLabel(overview.integration?.status)}</dd>
        </div>
        <div>
          <dt>Divergências abertas</dt>
          <dd>{overview.reconciliation.openFindingCount}</dd>
        </div>
        <div>
          <dt>Última execução</dt>
          <dd>{lastRun ? dateTime(lastRun.updatedAt) : "Ainda não executada"}</dd>
        </div>
        <div>
          <dt>Retorno remoto</dt>
          <dd>Parcial</dd>
        </div>
      </dl>
      <p className="doseclub-limit">
        “Parcial” não comprova resposta do DoseClub externo; a verificação atual cobre o estado
        persistido disponível no GiroMesa.
      </p>

      <div className="doseclub-columns">
        <section aria-labelledby="doseclub-mappings-title" className="doseclub-section">
          <div className="doseclub-section__heading">
            <h3 id="doseclub-mappings-title">Mapeamentos de estoque</h3>
            <span>{overview.mappings.length}</span>
          </div>
          {overview.mappings.length === 0 ? (
            <EmptyState
              description="Nenhum produto DoseClub está ligado ao estoque desta unidade."
              icon={<UiIcon name="inventory" />}
              title="Sem mapeamentos"
            />
          ) : (
            <div className="data-list">
              {overview.mappings.map((mapping) => (
                <article className="data-row" key={mapping.id}>
                  <div>
                    <strong>{mapping.productName}</strong>
                    <small>
                      {mapping.inventoryItemName} · {mapping.stockLocationName}
                    </small>
                    <small>Produto externo: {mapping.externalProductId}</small>
                  </div>
                  <Badge tone={mapping.active ? "success" : "warning"}>
                    {mapping.active ? "Ativo" : "Inativo"}
                  </Badge>
                </article>
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="doseclub-findings-title" className="doseclub-section">
          <div className="doseclub-section__heading">
            <h3 id="doseclub-findings-title">Divergências</h3>
            <span>{overview.findings.length}</span>
          </div>
          {overview.findings.length === 0 ? (
            <EmptyState
              description="A leitura persistida não retornou divergências para esta unidade."
              icon={<UiIcon name="success" />}
              title="Nenhuma divergência registrada"
            />
          ) : (
            <div className="data-list">
              {overview.findings.map((finding) => (
                <article className="data-row" key={finding.id}>
                  <div>
                    <strong>{findingLabel(finding.kind)}</strong>
                    <small>{finding.summary}</small>
                    <small>Detectada em {dateTime(finding.lastDetectedAt)}</small>
                  </div>
                  <div className="data-row__end">
                    <Badge
                      tone={
                        finding.status === "resolved"
                          ? "success"
                          : finding.severity === "critical"
                            ? "danger"
                            : "warning"
                      }
                    >
                      {finding.status === "open" ? "Aberta" : finding.status}
                    </Badge>
                    {finding.status === "open" && (
                      <Button
                        aria-busy={busy === `finding:${finding.id}`}
                        disabled={busy !== ""}
                        onClick={() =>
                          void runAction(`finding:${finding.id}`, () =>
                            api.growth.recheckDoseClubFinding(
                              scope.organizationId,
                              scope.unitId,
                              finding.id,
                              finding.version,
                            ),
                          )
                        }
                        size="sm"
                        variant="secondary"
                      >
                        Verificar novamente
                      </Button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <section
        aria-labelledby="doseclub-runs-title"
        className="doseclub-section doseclub-section--runs"
      >
        <div className="doseclub-section__heading">
          <h3 id="doseclub-runs-title">Histórico de verificações</h3>
          <span>{overview.runs.length}</span>
        </div>
        {overview.runs.length === 0 ? (
          <p className="muted">Nenhuma execução foi registrada nesta unidade.</p>
        ) : (
          <div className="doseclub-run-list">
            {overview.runs.map((run) => (
              <article className="doseclub-run" key={run.id}>
                <div>
                  <strong>{runLabel(run.status)}</strong>
                  <small>
                    {dateTime(run.createdAt)} · {run.findingCount} divergência(s)
                  </small>
                  {run.failureCode && <small>Código: {run.failureCode}</small>}
                </div>
                <div className="data-row__end">
                  <Badge
                    tone={
                      run.status === "completed"
                        ? "success"
                        : run.status === "failed"
                          ? "danger"
                          : "info"
                    }
                  >
                    {runLabel(run.status)}
                  </Badge>
                  {run.status === "failed" && (
                    <Button
                      aria-busy={busy === `run:${run.id}`}
                      disabled={busy !== ""}
                      onClick={() =>
                        void runAction(`run:${run.id}`, () =>
                          api.growth.retryDoseClubRun(
                            scope.organizationId,
                            scope.unitId,
                            run.id,
                            run.version,
                          ),
                        )
                      }
                      size="sm"
                      variant="secondary"
                    >
                      Tentar novamente
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
