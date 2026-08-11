import { Badge, Button, Card } from "@giromesa/ui";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ApiClientError, api } from "./api";

type Row = Record<string, unknown>;
type AsyncState<T> =
  | { status: "idle" | "loading" }
  | { status: "error"; error: unknown }
  | { status: "ready"; data: T };

const resources = [
  "tenant",
  "plan",
  "entitlements",
  "users",
  "onboarding",
  "billing",
  "integrations",
  "incidents",
  "audit",
  "leads",
  "support",
] as const;
type PlatformResource = (typeof resources)[number];

const resourceLabels: Record<PlatformResource, string> = {
  tenant: "Tenant",
  plan: "Plano",
  entitlements: "Entitlements",
  users: "Usuários",
  onboarding: "Onboarding",
  billing: "Billing",
  integrations: "Integrações",
  incidents: "Incidentes",
  audit: "Auditoria",
  leads: "Leads",
  support: "Suporte",
};

const knownPermissions = new Set([
  "platform.read",
  "platform.pii.read",
  "platform.action.propose",
  "platform.action.approve",
  "platform.action.reject",
  "platform.tenant.suspend",
  "platform.tenant.restore",
  "platform.membership.disable",
  "platform.membership.restore",
]);

export interface PlatformOverview {
  counts: { organizations: number; active: number; attention: number };
  access: { permissions: string[]; stepUp: boolean; stepUpExpiresAt: string | null };
}

interface PlatformTenantContext {
  organization: { id: string; name: string; billingState: string; updatedAt: string };
  units: Array<{ id: string; name: string; active: boolean; timezone: string }>;
  selectedUnitId: string | null;
}

interface PlatformProjection {
  resource: PlatformResource;
  availability: "available" | "unavailable";
  reasonCode?: string;
  items: Row[];
  nextCursor: string | null;
}

type PlatformActionName =
  | "tenant.suspend"
  | "tenant.restore"
  | "membership.disable"
  | "membership.restore";
type PlatformActionStatus = "pending" | "approved" | "executed" | "rejected" | "expired" | "failed";

interface PlatformAction {
  id: string;
  organizationId: string;
  action: PlatformActionName;
  targetType: "organization" | "membership";
  targetId: string;
  requestedByIdentityId: string;
  justification: string;
  payload: Record<string, string>;
  status: PlatformActionStatus;
  version: number;
  requestedAt: string;
  expiresAt: string;
  decidedByIdentityId?: string;
  decidedAt?: string;
  failureCode?: string;
}

interface PlatformActionPage {
  items: PlatformAction[];
  nextCursor: string | null;
}

export class InvalidPlatformPayloadError extends Error {
  constructor() {
    super("A API retornou o backoffice em formato inesperado.");
    this.name = "InvalidPlatformPayloadError";
  }
}

function record(value: unknown): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new InvalidPlatformPayloadError();
  return value as Row;
}

function exactRecord(value: unknown, keys: string[]) {
  const result = record(value);
  if (Object.keys(result).some((key) => !keys.includes(key)))
    throw new InvalidPlatformPayloadError();
  return result;
}

function records(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new InvalidPlatformPayloadError();
  return value.map(record);
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw new InvalidPlatformPayloadError();
  return value;
}

function nullableText(value: unknown): string | null {
  if (value === null) return null;
  return text(value);
}

function optionalText(value: unknown): string | undefined {
  return value === undefined ? undefined : text(value);
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new InvalidPlatformPayloadError();
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new InvalidPlatformPayloadError();
  return value;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new InvalidPlatformPayloadError();
  return value as string[];
}

export function parsePlatformOverview(value: unknown): PlatformOverview {
  const payload = exactRecord(value, ["counts", "access"]);
  const counts = exactRecord(payload.counts, ["organizations", "active", "attention"]);
  const access = exactRecord(payload.access, ["permissions", "stepUp", "stepUpExpiresAt"]);
  const permissions = stringArray(access.permissions);
  if (permissions.some((permission) => !knownPermissions.has(permission)))
    throw new InvalidPlatformPayloadError();
  return {
    counts: {
      organizations: number(counts.organizations),
      active: number(counts.active),
      attention: number(counts.attention),
    },
    access: {
      permissions,
      stepUp: boolean(access.stepUp),
      stepUpExpiresAt: nullableText(access.stepUpExpiresAt),
    },
  };
}

export function parsePlatformTenantContext(value: unknown): PlatformTenantContext {
  const payload = exactRecord(value, ["organization", "units", "selectedUnitId"]);
  const organization = exactRecord(payload.organization, [
    "id",
    "name",
    "billingState",
    "updatedAt",
  ]);
  const units = records(payload.units).map((unit) => {
    const safe = exactRecord(unit, ["id", "name", "active", "timezone"]);
    return {
      id: text(safe.id),
      name: text(safe.name),
      active: boolean(safe.active),
      timezone: text(safe.timezone),
    };
  });
  return {
    organization: {
      id: text(organization.id),
      name: text(organization.name),
      billingState: text(organization.billingState),
      updatedAt: text(organization.updatedAt),
    },
    units,
    selectedUnitId: nullableText(payload.selectedUnitId),
  };
}

export function parsePlatformProjection(value: unknown): PlatformProjection {
  const payload = exactRecord(value, [
    "resource",
    "availability",
    "reasonCode",
    "items",
    "nextCursor",
  ]);
  const resource = text(payload.resource) as PlatformResource;
  const availability = text(payload.availability);
  if (!resources.includes(resource) || !["available", "unavailable"].includes(availability))
    throw new InvalidPlatformPayloadError();
  const items = records(payload.items);
  const reasonCode = optionalText(payload.reasonCode);
  if (availability === "unavailable" && (!reasonCode || items.length > 0))
    throw new InvalidPlatformPayloadError();
  return {
    resource,
    availability: availability as PlatformProjection["availability"],
    ...(reasonCode ? { reasonCode } : {}),
    items,
    nextCursor: nullableText(payload.nextCursor),
  };
}

function parseActionPayload(action: PlatformActionName, value: unknown) {
  const payload = record(value);
  const allowed = action === "tenant.restore" ? ["expectedState", "restoreTo"] : ["expectedState"];
  if (Object.keys(payload).some((key) => !allowed.includes(key)))
    throw new InvalidPlatformPayloadError();
  const result: Record<string, string> = { expectedState: text(payload.expectedState) };
  if (action === "tenant.restore") result.restoreTo = text(payload.restoreTo);
  return result;
}

export function parsePlatformActionPage(value: unknown): PlatformActionPage {
  const payload = exactRecord(value, ["items", "nextCursor"]);
  const allowedActions: PlatformActionName[] = [
    "tenant.suspend",
    "tenant.restore",
    "membership.disable",
    "membership.restore",
  ];
  const allowedStatuses: PlatformActionStatus[] = [
    "pending",
    "approved",
    "executed",
    "rejected",
    "expired",
    "failed",
  ];
  const items = records(payload.items).map((item) => {
    const safe = exactRecord(item, [
      "id",
      "organizationId",
      "action",
      "targetType",
      "targetId",
      "requestedByIdentityId",
      "justification",
      "payload",
      "status",
      "version",
      "requestedAt",
      "expiresAt",
      "decidedByIdentityId",
      "decidedAt",
      "failureCode",
    ]);
    const action = text(safe.action) as PlatformActionName;
    const status = text(safe.status) as PlatformActionStatus;
    const targetType = text(safe.targetType);
    if (
      !allowedActions.includes(action) ||
      !allowedStatuses.includes(status) ||
      !["organization", "membership"].includes(targetType)
    )
      throw new InvalidPlatformPayloadError();
    return {
      id: text(safe.id),
      organizationId: text(safe.organizationId),
      action,
      targetType: targetType as PlatformAction["targetType"],
      targetId: text(safe.targetId),
      requestedByIdentityId: text(safe.requestedByIdentityId),
      justification: text(safe.justification),
      payload: parseActionPayload(action, safe.payload),
      status,
      version: number(safe.version),
      requestedAt: text(safe.requestedAt),
      expiresAt: text(safe.expiresAt),
      decidedByIdentityId: optionalText(safe.decidedByIdentityId),
      decidedAt: optionalText(safe.decidedAt),
      failureCode: optionalText(safe.failureCode),
    };
  });
  return { items, nextCursor: nullableText(payload.nextCursor) };
}

export function platformRecovery(error: unknown) {
  const status = error instanceof ApiClientError ? error.status : 0;
  if (status === 401)
    return {
      title: "Autenticação reforçada necessária",
      instruction: "Concluir MFA e tentar novamente.",
      canRetry: true,
    };
  if (status === 403)
    return {
      title: "Ação não autorizada",
      instruction: "Solicite a permissão explícita para esta operação.",
      canRetry: false,
    };
  if (status === 409)
    return {
      title: "Estado alterado",
      instruction: "Atualize o contexto antes de repetir a decisão.",
      canRetry: true,
    };
  if (status === 429)
    return {
      title: "Limite temporário",
      instruction: "Aguarde e tente novamente.",
      canRetry: true,
    };
  return {
    title: status >= 500 ? "Serviço indisponível" : "Não foi possível concluir",
    instruction:
      status >= 500
        ? "Tente novamente; nenhum sucesso foi confirmado."
        : "Revise os dados e tente novamente.",
    canRetry: status === 0 || status >= 500,
  };
}

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Data inválida"
    : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function actionLabel(action: PlatformActionName) {
  return {
    "tenant.suspend": "Suspender tenant",
    "tenant.restore": "Restaurar tenant",
    "membership.disable": "Desativar usuário",
    "membership.restore": "Restaurar usuário",
  }[action];
}

function actionPermission(action: PlatformActionName) {
  return `platform.${action}`;
}

function actionTone(
  status: PlatformActionStatus,
): "neutral" | "info" | "success" | "warning" | "danger" {
  if (status === "executed") return "success";
  if (status === "pending" || status === "approved") return "warning";
  if (status === "failed") return "danger";
  return "neutral";
}

function statusLabel(status: PlatformActionStatus) {
  return {
    pending: "Aguardando aprovação",
    approved: "Aprovada",
    executed: "Executada",
    rejected: "Rejeitada",
    expired: "Expirada",
    failed: "Falhou sem confirmação",
  }[status];
}

function safeColumns(resource: PlatformResource, row: Row): Array<[string, unknown]> {
  const columns: Partial<Record<PlatformResource, string[]>> = {
    tenant: ["name", "billingState", "updatedAt", "units"],
    plan: ["name", "slug", "selectionRevision", "selectedAt"],
    entitlements: ["entitlement", "state", "activatedAt", "revokedAt"],
    users: ["displayName", "email", "status", "roles", "membershipId"],
    onboarding: ["kind", "item", "status", "state", "checkpoint", "lastErrorCode"],
    billing: ["state", "cycle", "currentPeriodEndsAt", "updatedAt"],
    integrations: ["provider", "status", "unitId", "updatedAt"],
    audit: ["action", "entityType", "entityId", "occurredAt"],
  };
  return (columns[resource] ?? []).flatMap<[string, unknown]>((key) =>
    row[key] === undefined ? [] : [[key, row[key]]],
  );
}

function cellValue(value: unknown): string {
  if (value === null) return "Não informado";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) {
    return value
      .slice(0, 12)
      .map((item) => {
        const row = record(item);
        return typeof row.name === "string"
          ? row.name
          : typeof row.role === "string"
            ? row.role
            : "Item escopado";
      })
      .join(", ");
  }
  return "Dado protegido";
}

function ErrorNotice({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const recovery = platformRecovery(error);
  return (
    <div className="platform-error" role="alert">
      <div>
        <strong>{recovery.title}</strong>
        <p>{recovery.instruction}</p>
      </div>
      {recovery.canRetry && (
        <Button onClick={onRetry} size="sm" variant="secondary">
          Tentar novamente
        </Button>
      )}
    </div>
  );
}

function PlatformSkeleton() {
  return (
    <div aria-label="Carregando backoffice" className="platform-skeleton" role="status">
      <span />
      <span />
      <span />
    </div>
  );
}

export function RealPlatformPage({
  actorIdentityId,
  refreshToken,
}: {
  actorIdentityId: string;
  refreshToken: number;
}) {
  const [overview, setOverview] = useState<AsyncState<PlatformOverview>>({ status: "loading" });
  const [tenantInput, setTenantInput] = useState("");
  const [context, setContext] = useState<AsyncState<PlatformTenantContext>>({ status: "idle" });
  const [selectedResource, setSelectedResource] = useState<PlatformResource>("tenant");
  const [projection, setProjection] = useState<AsyncState<PlatformProjection>>({ status: "idle" });
  const [actions, setActions] = useState<AsyncState<PlatformActionPage>>({ status: "idle" });
  const [unitId, setUnitId] = useState("");
  const [mutationError, setMutationError] = useState<unknown>(null);
  const [mutating, setMutating] = useState(false);
  const [action, setAction] = useState<PlatformActionName>("tenant.suspend");
  const [targetId, setTargetId] = useState("");
  const [restoreTo, setRestoreTo] = useState("active");
  const [justification, setJustification] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const loadOverview = useCallback(() => {
    setOverview({ status: "loading" });
    api.platform
      .overview()
      .then(parsePlatformOverview)
      .then((data) => setOverview({ status: "ready", data }))
      .catch((error: unknown) => setOverview({ status: "error", error }));
  }, []);

  useEffect(() => {
    void refreshToken;
    loadOverview();
  }, [loadOverview, refreshToken]);

  const loadActions = useCallback((organizationId: string) => {
    setActions({ status: "loading" });
    return api.platform
      .actions(organizationId)
      .then(parsePlatformActionPage)
      .then((data) => setActions({ status: "ready", data }))
      .catch((error: unknown) => setActions({ status: "error", error }));
  }, []);

  const loadProjection = useCallback(
    (organizationId: string, resource: PlatformResource, selectedUnitId?: string) => {
      setProjection({ status: "loading" });
      return api.platform
        .projection(organizationId, resource, {
          unitId: selectedUnitId || undefined,
          limit: 50,
        })
        .then(parsePlatformProjection)
        .then((data) => setProjection({ status: "ready", data }))
        .catch((error: unknown) => setProjection({ status: "error", error }));
    },
    [],
  );

  async function loadContext(event?: FormEvent) {
    event?.preventDefault();
    const organizationId = tenantInput.trim();
    if (!organizationId) return;
    setContext({ status: "loading" });
    setMutationError(null);
    try {
      const data = parsePlatformTenantContext(await api.platform.context(organizationId));
      setContext({ status: "ready", data });
      setTargetId(data.organization.id);
      setUnitId("");
      await Promise.all([
        loadProjection(data.organization.id, selectedResource),
        loadActions(data.organization.id),
      ]);
    } catch (error) {
      setContext({ status: "error", error });
    }
  }

  const activeContext = context.status === "ready" ? context.data : null;
  const activeOverview = overview.status === "ready" ? overview.data : null;
  const permissions = activeOverview?.access.permissions ?? [];
  const needsMembershipTarget = action.startsWith("membership.");
  const expectedState =
    action === "tenant.suspend"
      ? activeContext?.organization.billingState
      : action.endsWith("restore")
        ? action.startsWith("tenant.")
          ? "suspended"
          : "disabled"
        : "active";
  const canPropose =
    Boolean(activeContext) &&
    activeOverview?.access.stepUp === true &&
    permissions.includes("platform.action.propose") &&
    permissions.includes(actionPermission(action)) &&
    justification.trim().length >= 20 &&
    confirmed &&
    (!needsMembershipTarget || targetId.trim().length > 0);

  const impact = useMemo(() => {
    if (action === "tenant.suspend")
      return "Bloqueia novos efeitos operacionais conforme a política de billing do tenant.";
    if (action === "tenant.restore")
      return `Restaura o tenant para o estado ${restoreTo}; o estado atual deve continuar suspenso.`;
    if (action === "membership.disable")
      return "Desativa o acesso da membership; o último owner ativo permanece protegido.";
    return "Restaura a membership desativada para o estado ativo.";
  }, [action, restoreTo]);

  async function submitProposal(event: FormEvent) {
    event.preventDefault();
    if (!activeContext || !canPropose) return;
    setMutating(true);
    setMutationError(null);
    try {
      const payload =
        action === "tenant.restore" ? { expectedState: "suspended", restoreTo } : { expectedState };
      await api.platform.propose(
        activeContext.organization.id,
        {
          action,
          targetId: needsMembershipTarget ? targetId.trim() : activeContext.organization.id,
          justification: justification.trim(),
          payload,
        },
        crypto.randomUUID(),
      );
      setJustification("");
      setConfirmed(false);
      await Promise.all([
        loadActions(activeContext.organization.id),
        loadProjection(activeContext.organization.id, selectedResource, unitId),
      ]);
    } catch (error) {
      setMutationError(error);
    } finally {
      setMutating(false);
    }
  }

  async function decide(item: PlatformAction, command: "approve" | "reject") {
    if (!activeContext) return;
    setMutating(true);
    setMutationError(null);
    try {
      if (command === "approve")
        await api.platform.approve(
          activeContext.organization.id,
          item.id,
          item.version,
          crypto.randomUUID(),
        );
      else
        await api.platform.reject(
          activeContext.organization.id,
          item.id,
          item.version,
          crypto.randomUUID(),
        );
      await Promise.all([
        loadActions(activeContext.organization.id),
        loadProjection(activeContext.organization.id, selectedResource, unitId),
        api.platform
          .context(activeContext.organization.id, unitId || undefined)
          .then(parsePlatformTenantContext)
          .then((data) => setContext({ status: "ready", data })),
      ]);
    } catch (error) {
      setMutationError(error);
    } finally {
      setMutating(false);
    }
  }

  function selectResource(resource: PlatformResource) {
    setSelectedResource(resource);
    if (activeContext) void loadProjection(activeContext.organization.id, resource, unitId);
  }

  function navigateResources(event: KeyboardEvent<HTMLButtonElement>, resource: PlatformResource) {
    const currentIndex = resources.indexOf(resource);
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % resources.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + resources.length) % resources.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = resources.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    const nextResource = resources[nextIndex];
    if (!nextResource) return;
    selectResource(nextResource);
    document.getElementById(`platform-tab-${nextResource}`)?.focus();
  }

  return (
    <div className="platform-workspace">
      <header className="platform-commandbar">
        <div>
          <h1>Controle da plataforma</h1>
          <p>
            Consultas começam em modo leitura. Toda ação crítica exige MFA recente e outra pessoa.
          </p>
        </div>
        <div className="platform-commandbar__state">
          <Badge tone="neutral">Ambiente da API</Badge>
          <Badge tone="info">Modo leitura</Badge>
          <span>{activeOverview?.access.stepUp ? "MFA recente" : "MFA necessária para ações"}</span>
        </div>
      </header>

      {overview.status === "loading" && <PlatformSkeleton />}
      {overview.status === "error" && <ErrorNotice error={overview.error} onRetry={loadOverview} />}
      {overview.status === "ready" && (
        <section aria-label="Resumo da plataforma" className="platform-summary">
          <div>
            <span>Organizações</span>
            <strong>{overview.data.counts.organizations}</strong>
          </div>
          <div>
            <span>Ativas</span>
            <strong>{overview.data.counts.active}</strong>
          </div>
          <div>
            <span>Exigem atenção</span>
            <strong>{overview.data.counts.attention}</strong>
          </div>
          <div>
            <span>Privilégio</span>
            <strong>{overview.data.access.permissions.length} grants</strong>
          </div>
        </section>
      )}

      <Card className="platform-context-card">
        <form className="platform-context-form" onSubmit={loadContext}>
          <label>
            Tenant por ID exato
            <input
              autoComplete="off"
              onChange={(event) => setTenantInput(event.target.value)}
              placeholder="UUID da organização"
              spellCheck={false}
              value={tenantInput}
            />
          </label>
          <Button disabled={!tenantInput.trim() || context.status === "loading"} type="submit">
            {context.status === "loading" ? "Carregando…" : "Carregar contexto"}
          </Button>
        </form>
        <p className="platform-context-help">
          A busca não enumera tenants. Use o identificador confirmado no atendimento ou incidente.
        </p>
        {context.status === "error" && (
          <ErrorNotice error={context.error} onRetry={() => void loadContext()} />
        )}
      </Card>

      {activeContext && (
        <>
          <aside className="platform-scope" aria-label="Contexto administrativo ativo">
            <div>
              <span>Tenant ativo</span>
              <strong>{activeContext.organization.name}</strong>
              <small>{activeContext.organization.id}</small>
            </div>
            <div>
              <span>Estado</span>
              <strong>{activeContext.organization.billingState}</strong>
            </div>
            <label>
              Unidade
              <select
                onChange={(event) => {
                  const nextUnit = event.target.value;
                  setUnitId(nextUnit);
                  void loadProjection(activeContext.organization.id, selectedResource, nextUnit);
                }}
                value={unitId}
              >
                <option value="">Todas neste tenant</option>
                {activeContext.units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </label>
          </aside>

          <div className="platform-tabs" role="tablist" aria-label="Domínios do backoffice">
            {resources.map((resource) => (
              <button
                aria-controls={`platform-panel-${resource}`}
                aria-selected={resource === selectedResource}
                id={`platform-tab-${resource}`}
                key={resource}
                onClick={() => selectResource(resource)}
                onKeyDown={(event) => navigateResources(event, resource)}
                role="tab"
                tabIndex={resource === selectedResource ? 0 : -1}
                type="button"
              >
                {resourceLabels[resource]}
              </button>
            ))}
          </div>

          <div className="platform-content-grid">
            <section
              aria-labelledby={`platform-tab-${selectedResource}`}
              className="platform-projection"
              id={`platform-panel-${selectedResource}`}
              role="tabpanel"
            >
              <div className="platform-section-heading">
                <div>
                  <h2 id="platform-projection-title">{resourceLabels[selectedResource]}</h2>
                  <p>Projection sanitizada e limitada ao contexto acima.</p>
                </div>
                <Badge tone="info">Leitura</Badge>
              </div>
              {projection.status === "loading" && <PlatformSkeleton />}
              {projection.status === "error" && (
                <ErrorNotice
                  error={projection.error}
                  onRetry={() =>
                    void loadProjection(activeContext.organization.id, selectedResource, unitId)
                  }
                />
              )}
              {projection.status === "ready" && projection.data.availability === "unavailable" && (
                <div className="platform-unavailable" role="status">
                  <strong>Fonte ainda não conectada nesta base</strong>
                  <p>{projection.data.reasonCode}</p>
                  <span>Nenhum dado ou sucesso foi simulado.</span>
                </div>
              )}
              {projection.status === "ready" && projection.data.availability === "available" && (
                <div className="platform-records">
                  {projection.data.items.length === 0 ? (
                    <div className="platform-empty">
                      <strong>Sem registros neste contexto</strong>
                      <span>A fonte respondeu sem itens.</span>
                    </div>
                  ) : (
                    projection.data.items.map((row, index) => (
                      <article
                        className="platform-record"
                        key={String(row.id ?? row.membershipId ?? index)}
                      >
                        {safeColumns(selectedResource, row).map(([key, value]) => (
                          <div key={key}>
                            <span>{key}</span>
                            <strong>{cellValue(value)}</strong>
                          </div>
                        ))}
                      </article>
                    ))
                  )}
                </div>
              )}
            </section>

            <section aria-labelledby="platform-action-title" className="platform-actions-panel">
              <div className="platform-section-heading">
                <div>
                  <h2 id="platform-action-title">Propor ação crítica</h2>
                  <p>A proposta não executa nada até uma aprovação independente.</p>
                </div>
              </div>
              <form className="platform-action-form" onSubmit={submitProposal}>
                <label>
                  Ação
                  <select
                    onChange={(event) => {
                      const next = event.target.value as PlatformActionName;
                      setAction(next);
                      setTargetId(next.startsWith("tenant.") ? activeContext.organization.id : "");
                    }}
                    value={action}
                  >
                    <option value="tenant.suspend">Suspender tenant</option>
                    <option value="tenant.restore">Restaurar tenant</option>
                    <option value="membership.disable">Desativar usuário</option>
                    <option value="membership.restore">Restaurar usuário</option>
                  </select>
                </label>
                <label>
                  Alvo
                  <input
                    disabled={!needsMembershipTarget}
                    onChange={(event) => setTargetId(event.target.value)}
                    value={needsMembershipTarget ? targetId : activeContext.organization.id}
                  />
                </label>
                {action === "tenant.restore" && (
                  <label>
                    Restaurar para
                    <select
                      onChange={(event) => setRestoreTo(event.target.value)}
                      value={restoreTo}
                    >
                      <option value="active">active</option>
                      <option value="trial_active">trial_active</option>
                      <option value="grace">grace</option>
                      <option value="restricted">restricted</option>
                    </select>
                  </label>
                )}
                <div className="platform-impact">
                  <strong>Impacto</strong>
                  <p>{impact}</p>
                </div>
                <label>
                  Justificativa auditável
                  <textarea
                    maxLength={500}
                    minLength={20}
                    onChange={(event) => setJustification(event.target.value)}
                    placeholder="Descreva evidência, impacto e plano de recuperação."
                    required
                    value={justification}
                  />
                </label>
                <label className="platform-confirmation">
                  <input
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    type="checkbox"
                  />
                  <span>Confirmo o tenant, o alvo e o impacto acima.</span>
                </label>
                {!activeOverview?.access.stepUp && (
                  <p className="platform-blocker">Conclua MFA para habilitar ações.</p>
                )}
                {!permissions.includes(actionPermission(action)) && (
                  <p className="platform-blocker">Seu acesso não possui o grant desta ação.</p>
                )}
                <Button disabled={!canPropose || mutating} type="submit">
                  {mutating ? "Registrando…" : "Criar proposta"}
                </Button>
              </form>
            </section>
          </div>

          <section aria-labelledby="platform-approvals-title" className="platform-approvals">
            <div className="platform-section-heading">
              <div>
                <h2 id="platform-approvals-title">Aprovações e execução</h2>
                <p>Ledger append-only com versão, expiração e resultado explícitos.</p>
              </div>
              <Button
                onClick={() => void loadActions(activeContext.organization.id)}
                size="sm"
                variant="secondary"
              >
                Atualizar fila
              </Button>
            </div>
            {mutationError !== null && (
              <ErrorNotice
                error={mutationError}
                onRetry={() => void loadActions(activeContext.organization.id)}
              />
            )}
            {actions.status === "loading" && <PlatformSkeleton />}
            {actions.status === "error" && (
              <ErrorNotice
                error={actions.error}
                onRetry={() => void loadActions(activeContext.organization.id)}
              />
            )}
            {actions.status === "ready" && actions.data.items.length === 0 && (
              <div className="platform-empty">
                <strong>Nenhuma ação proposta</strong>
                <span>O tenant segue somente em leitura.</span>
              </div>
            )}
            {actions.status === "ready" && (
              <div className="platform-action-list">
                {actions.data.items.map((item) => {
                  const canApprove =
                    item.status === "pending" &&
                    item.requestedByIdentityId !== actorIdentityId &&
                    activeOverview?.access.stepUp === true &&
                    permissions.includes("platform.action.approve") &&
                    permissions.includes(actionPermission(item.action));
                  const canReject =
                    item.status === "pending" &&
                    activeOverview?.access.stepUp === true &&
                    permissions.includes("platform.action.reject") &&
                    permissions.includes(actionPermission(item.action));
                  return (
                    <article className="platform-action-row" key={item.id}>
                      <div>
                        <span>{actionLabel(item.action)}</span>
                        <strong>{item.justification}</strong>
                        <small>
                          v{item.version} · criada {dateTime(item.requestedAt)} · expira{" "}
                          {dateTime(item.expiresAt)}
                        </small>
                      </div>
                      <Badge tone={actionTone(item.status)}>{statusLabel(item.status)}</Badge>
                      {item.status === "pending" && (
                        <div className="platform-action-row__buttons">
                          <Button
                            disabled={!canReject || mutating}
                            onClick={() => void decide(item, "reject")}
                            size="sm"
                            variant="secondary"
                          >
                            Rejeitar
                          </Button>
                          <Button
                            disabled={!canApprove || mutating}
                            onClick={() => void decide(item, "approve")}
                            size="sm"
                          >
                            Aprovar e executar
                          </Button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
