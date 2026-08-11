import { Badge, Button, Progress } from "@giromesa/ui";
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  ApiClientError,
  api,
  type ChecklistItem,
  type ChecklistStatus,
  type OnboardingResponse,
  type OnboardingSelectionInput,
  type OnboardingUpdateInput,
  type ProvisioningState,
} from "./api";
import type { ProfileId, Unit } from "./domain";
import { routeHref } from "./router";

export type { OnboardingResponse } from "./api";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type PublicError = { status: number; code: string; message: string };
type ErrorGuidance = {
  title: string;
  message: string;
  action: string;
  sessionEnded?: boolean;
  permissionLocked?: boolean;
};

type ChecklistDefinition = {
  item: ChecklistItem;
  label: string;
  why: string;
  recovery: string;
  icon: IconName;
};

type ChecklistGroup = {
  id: string;
  title: string;
  description: string;
  items: readonly ChecklistDefinition[];
};

type IconName =
  | "business"
  | "unit"
  | "plan"
  | "fiscal"
  | "catalog"
  | "tables"
  | "team"
  | "qr"
  | "production"
  | "cashier"
  | "training"
  | "rehearsal"
  | "lock"
  | "refresh"
  | "check";

const PLAN_OPTIONS = [
  { slug: "operacao", label: "Operação" },
  { slug: "crescimento", label: "Crescimento" },
  { slug: "rede", label: "Rede" },
] as const;

const TERMINAL_STATES = new Set<ProvisioningState>(["completed", "terminal_failed", "compensated"]);

const ACTIVE_POLL_STATES = new Set<ProvisioningState>([
  "requested",
  "validating",
  "provisioning",
  "activating",
  "publishing",
  "compensating",
]);

const POLLING_DELAYS = [1_000, 1_500, 2_500, 4_000, 6_000, 8_000] as const;
const MAX_POLL_ATTEMPTS = 30;

export const CHECKLIST_GROUPS: readonly ChecklistGroup[] = [
  {
    id: "empresa",
    title: "Empresa",
    description: "Identidade, unidade comercial e escolhas que definem o início da operação.",
    items: [
      {
        item: "business",
        label: "Negócio",
        why: "Vincula a configuração à organização que responde pela operação.",
        recovery: "Revise os dados da organização e atualize a verificação do servidor.",
        icon: "business",
      },
      {
        item: "unit",
        label: "Unidade",
        why: "Mantém catálogo, salão, equipe e caixa no escopo operacional correto.",
        recovery: "Abra a gestão de unidades, corrija o cadastro e retorne para atualizar.",
        icon: "unit",
      },
      {
        item: "plan",
        label: "Plano",
        why: "Fixa a versão comercial e os recursos usados pela ativação idempotente.",
        recovery: "Selecione um plano publicado e confirme qualquer troca de unidade ou plano.",
        icon: "plan",
      },
      {
        item: "fiscalChoice",
        label: "Escolha fiscal",
        why: "Registra se a unidade ficará sem emissão, usará Focus ou uma solução externa.",
        recovery: "Escolha o modo real; integração externa não significa conexão homologada.",
        icon: "fiscal",
      },
    ],
  },
  {
    id: "operacao",
    title: "Operação",
    description: "A base que permite receber clientes e operar uma unidade de verdade.",
    items: [
      {
        item: "catalog",
        label: "Catálogo",
        why: "Produtos e preços publicados alimentam atendimento, QR e produção.",
        recovery: "Cadastre e publique produtos na tela de Cardápio, depois atualize o status.",
        icon: "catalog",
      },
      {
        item: "tables",
        label: "Mesas",
        why: "O salão precisa de mesas reais para ocupação, QR e ensaio do atendimento.",
        recovery: "Configure o salão da unidade e retorne para a revalidação do servidor.",
        icon: "tables",
      },
      {
        item: "team",
        label: "Equipe",
        why: "Pessoas ativas e papéis corretos mantêm autorização e responsabilidade claras.",
        recovery: "Adicione a equipe na área Pessoas e confirme os acessos da unidade.",
        icon: "team",
      },
    ],
  },
  {
    id: "atendimento",
    title: "Atendimento",
    description: "Canais, produção e caixa que sustentam o percurso do pedido.",
    items: [
      {
        item: "qr",
        label: "QR da mesa",
        why: "O QR só fica pronto com menu, mesas, capabilities e teste confirmados no servidor.",
        recovery: "Conclua menu e mesas; se QR não fizer parte do piloto, o owner pode dispensar.",
        icon: "qr",
      },
      {
        item: "production",
        label: "Rota de produção",
        why: "Define se pedidos ficam desligados, vão ao KDS, à impressão ou aos dois destinos.",
        recovery: "Somente desligado confirma aqui; KDS e impressão exigem configuração real.",
        icon: "production",
      },
      {
        item: "cashier",
        label: "Caixa",
        why: "A unidade precisa de um fluxo de caixa verificável para fechar o ensaio.",
        recovery: "Configure o caixa na área correspondente e atualize a evidência ao retornar.",
        icon: "cashier",
      },
    ],
  },
  {
    id: "prontidao",
    title: "Prontidão",
    description: "Confirmação consciente de que a equipe praticou o fluxo antes do trial.",
    items: [
      {
        item: "training",
        label: "Treinamento",
        why: "Confirma que a equipe conhece o mínimo necessário para iniciar a operação.",
        recovery: "Revise o percurso com a equipe e confirme somente depois da prática.",
        icon: "training",
      },
      {
        item: "rehearsal",
        label: "Ensaio operacional",
        why: "Valida o percurso de atendimento, produção e caixa antes de iniciar o relógio.",
        recovery: "Execute um ensaio completo e confirme o resumo do que foi verificado.",
        icon: "rehearsal",
      },
    ],
  },
] as const;

export function activationStorageKey(organizationId: string): string {
  return `giromesa:onboarding:activation:${organizationId}`;
}

export function getOrCreateActivationKey(
  organizationId: string,
  storage: StorageLike,
  createKey: () => string = () => crypto.randomUUID(),
): string {
  const key = activationStorageKey(organizationId);
  const existing = storage.getItem(key);
  if (existing && existing.length >= 8 && existing.length <= 160) return existing;
  const created = createKey();
  if (created.length < 8 || created.length > 160) {
    throw new Error("Não foi possível criar uma chave de ativação válida.");
  }
  storage.setItem(key, created);
  return created;
}

export function isTerminalProvisioningState(state: ProvisioningState): boolean {
  return TERMINAL_STATES.has(state);
}

export function releaseActivationKey(
  organizationId: string,
  state: ProvisioningState,
  storage: StorageLike,
) {
  if (isTerminalProvisioningState(state)) {
    storage.removeItem(activationStorageKey(organizationId));
  }
}

export function pollingDelay(attempt: number): number {
  return POLLING_DELAYS[Math.min(Math.max(0, attempt), POLLING_DELAYS.length - 1)] ?? 8_000;
}

export function shouldPollProvisioning({
  online,
  visible,
  state,
}: {
  online: boolean;
  visible: boolean;
  state: ProvisioningState;
}): boolean {
  return online && visible && ACTIVE_POLL_STATES.has(state);
}

export function activationAllowed(
  snapshot: OnboardingResponse,
  profileId: ProfileId,
  online: boolean,
  busy: boolean,
): boolean {
  return (
    profileId === "owner" &&
    online &&
    !busy &&
    !snapshot.activatedAt &&
    snapshot.ready &&
    snapshot.missingItems.length === 0
  );
}

export function createAttestationUpdate(
  item: "fiscalChoice",
  value: "disabled" | "focus" | "external",
): OnboardingUpdateInput;
export function createAttestationUpdate(
  item: "training" | "rehearsal",
  value: true,
): OnboardingUpdateInput;
export function createAttestationUpdate(
  item: "fiscalChoice" | "training" | "rehearsal",
  value: "disabled" | "focus" | "external" | true,
): OnboardingUpdateInput {
  if (item === "fiscalChoice" && value !== true) {
    return {
      items: {
        fiscalChoice: {
          status: "verified",
          evidenceReference: `ops:fiscal:${value}`,
          evidence: { choice: value },
        },
      },
    };
  }
  if ((item === "training" || item === "rehearsal") && value === true) {
    return {
      items: {
        [item]: {
          status: "verified",
          evidenceReference: `ops:${item}:completed`,
          evidence: { completed: true },
        },
      },
    };
  }
  throw new Error("Evidência de onboarding incompatível com o item.");
}

type ProductionChoice =
  | { mode: "off" }
  | { mode: "kds"; kdsStationIds: string[]; configurationReference?: string }
  | { mode: "print"; printerProfileIds: string[]; configurationReference?: string }
  | {
      mode: "both";
      kdsStationIds: string[];
      printerProfileIds: string[];
      configurationReference?: string;
    };

export function createProductionUpdate(choice: ProductionChoice): OnboardingUpdateInput {
  if (choice.mode === "off") {
    return {
      items: {
        production: {
          status: "verified",
          evidenceReference: "ops:production:off",
          evidence: { mode: "off" },
        },
      },
    };
  }
  if ((choice.mode === "kds" || choice.mode === "both") && choice.kdsStationIds.length === 0) {
    throw new Error("Selecione ao menos uma estação real antes de registrar KDS.");
  }
  if (
    (choice.mode === "print" || choice.mode === "both") &&
    choice.printerProfileIds.length === 0
  ) {
    throw new Error("Selecione ao menos um perfil real antes de registrar impressão.");
  }
  return {
    items: {
      production: {
        status: "in_progress",
        evidenceReference: `ops:production:${choice.mode}`,
        evidence: choice,
      },
    },
  };
}

export function createQrWaiverUpdate(
  reason: "pilot_without_qr" | "external_qr" | "not_required",
  waiverReason: string,
): OnboardingUpdateInput {
  const normalized = waiverReason.trim();
  if (normalized.length < 10) {
    throw new Error("A justificativa precisa ter pelo menos 10 caracteres.");
  }
  return {
    items: {
      qr: {
        status: "not_applicable",
        evidence: { reason },
        waiverReason: normalized,
      },
    },
  };
}

export function errorGuidance(error: PublicError): ErrorGuidance {
  if (error.status === 401) {
    return {
      title: "Sua sessão terminou",
      message: error.message || "Entre novamente para continuar o onboarding.",
      action: "Entrar novamente",
      sessionEnded: true,
    };
  }
  if (error.status === 403) {
    return {
      title: "Acesso restrito",
      message: error.message || "Seu perfil não pode alterar este onboarding.",
      action: "Manter em modo de consulta",
      permissionLocked: true,
    };
  }
  if (error.status === 404) {
    return {
      title: "Onboarding não encontrado",
      message: error.message || "Confirme a organização selecionada e tente novamente.",
      action: "Atualizar contexto",
    };
  }
  if (error.status === 409) {
    return {
      title: "O estado mudou no servidor",
      message: error.message || "Revise a seleção e atualize os requisitos antes de continuar.",
      action: error.code === "ONBOARDING_RESELECT_REQUIRED" ? "Revisar seleção" : "Atualizar",
    };
  }
  if (error.status === 429) {
    return {
      title: "Muitas tentativas",
      message: "Aguarde antes de repetir esta ação. A tentativa atual continua preservada.",
      action: "Tentar mais tarde",
    };
  }
  if (error.status === 0) {
    return {
      title: "Sem conexão com o servidor",
      message: error.message || "Reconecte para atualizar ou alterar o onboarding.",
      action: "Tentar novamente",
    };
  }
  if (error.status >= 500) {
    return {
      title: "Não foi possível concluir",
      message:
        "O servidor não concluiu a solicitação. A tentativa pode ser retomada com segurança.",
      action: "Tentar novamente",
    };
  }
  return {
    title: "Revise as informações",
    message: error.message || "Corrija os campos indicados e tente novamente.",
    action: "Revisar",
  };
}

export function OnboardingPage({
  organizationId,
  unitId,
  units,
  profileId,
  onUnauthorized,
  onUnitSelected,
}: {
  organizationId: string;
  unitId: string;
  units: Unit[];
  profileId: ProfileId;
  onUnauthorized?: () => void;
  onUnitSelected?: (unitId: string) => void;
}) {
  const authorized = profileId === "owner" || profileId === "manager";
  const [snapshot, setSnapshot] = useState<OnboardingResponse | null>(null);
  const [loading, setLoading] = useState(authorized);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [visible, setVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );
  const [pollAttempt, setPollAttempt] = useState(0);
  const [pollPaused, setPollPaused] = useState(false);
  const [error, setError] = useState<ErrorGuidance | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const showError = useCallback(
    (caught: unknown) => {
      const source =
        caught instanceof ApiClientError
          ? { status: caught.status, code: caught.code, message: caught.message }
          : { status: 0, code: "UNEXPECTED_CLIENT_ERROR", message: "Não foi possível continuar." };
      const guidance = errorGuidance(source);
      setError(guidance);
      if (guidance.permissionLocked) setLocked(true);
      if (guidance.sessionEnded) onUnauthorized?.();
    },
    [onUnauthorized],
  );

  useEffect(() => {
    if (!error || loading) return undefined;
    const timer = globalThis.setTimeout(() => errorRef.current?.focus(), 60);
    return () => globalThis.clearTimeout(timer);
  }, [error, loading]);

  const refresh = useCallback(async () => {
    if (!authorized || !organizationId) return;
    setError(null);
    try {
      const next = await api.onboarding.get(organizationId);
      setSnapshot(next);
    } catch (caught) {
      showError(caught);
    } finally {
      setLoading(false);
    }
  }, [authorized, organizationId, showError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return undefined;
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    const handleVisibility = () => setVisible(document.visibilityState === "visible");
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  useEffect(() => {
    const run = snapshot?.provisioning;
    if (!run || pollPaused || pollAttempt >= MAX_POLL_ATTEMPTS) return undefined;
    if (!shouldPollProvisioning({ online, visible, state: run.state })) return undefined;
    const controller = new AbortController();
    const timer = globalThis.setTimeout(async () => {
      try {
        const status = await api.onboarding.provisioning(organizationId, run.id, controller.signal);
        setSnapshot((current) => (current ? { ...current, provisioning: status } : current));
        setPollAttempt((attempt) => attempt + 1);
        if (isTerminalProvisioningState(status.state)) {
          const storage = browserSessionStorage();
          if (storage) releaseActivationKey(organizationId, status.state, storage);
          await refresh();
        }
      } catch (caught) {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          showError(caught);
          setPollAttempt((attempt) => attempt + 1);
        }
      }
    }, pollingDelay(pollAttempt));
    return () => {
      controller.abort();
      globalThis.clearTimeout(timer);
    };
  }, [online, organizationId, pollAttempt, pollPaused, refresh, showError, snapshot, visible]);

  useEffect(() => {
    if (pollAttempt >= MAX_POLL_ATTEMPTS) setPollPaused(true);
  }, [pollAttempt]);

  if (!authorized) {
    return (
      <PermissionBlock message="O onboarding operacional está disponível somente para proprietário ou gerente. Nenhuma solicitação foi enviada." />
    );
  }

  if (loading) return <OnboardingLoading />;

  if (!snapshot) {
    return (
      <section
        aria-labelledby="onboarding-empty-title"
        className="onboarding-empty"
        ref={errorRef}
        role={error ? "alert" : "status"}
        tabIndex={-1}
      >
        <Icon name="refresh" />
        <h2 id="onboarding-empty-title">O onboarding ainda não pôde ser carregado</h2>
        <p>{error?.message ?? "Confirme a conexão e a organização selecionada."}</p>
        <Button onClick={() => void refresh()}>Tentar novamente</Button>
      </section>
    );
  }

  async function mutate(request: () => Promise<OnboardingResponse>) {
    if (!online || locked || busy) return;
    setBusy(true);
    setError(null);
    try {
      setSnapshot(await request());
    } catch (caught) {
      showError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function patch(input: OnboardingUpdateInput) {
    await mutate(() => api.onboarding.update(organizationId, input));
  }

  async function select(input: OnboardingSelectionInput) {
    if (profileId !== "owner") return;
    setBusy(true);
    setError(null);
    try {
      await api.onboarding.select(organizationId, input);
      onUnitSelected?.(input.selectedUnitId);
      await refresh();
    } catch (caught) {
      showError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function activate() {
    if (!snapshot || !activationAllowed(snapshot, profileId, online, busy)) return;
    const currentSnapshot = snapshot;
    const storage = browserSessionStorage();
    if (!storage) {
      showError(
        new ApiClientError(
          "Este navegador não permite preservar a chave da tentativa.",
          400,
          "ACTIVATION_STORAGE_UNAVAILABLE",
          false,
        ),
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const idempotencyKey = getOrCreateActivationKey(organizationId, storage);
      const result = await api.onboarding.activate(
        organizationId,
        currentSnapshot.selection ? { planSlug: currentSnapshot.selection.plan.slug } : {},
        idempotencyKey,
      );
      releaseActivationKey(organizationId, result.state, storage);
      await refresh();
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.details?.provisioningRunId) {
        await refresh();
      }
      showError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!online && (
        <div className="onboarding-connectivity" role="status">
          <Icon name="lock" />
          <span>
            <strong>Sem conexão.</strong> O progresso salvo continua no servidor, mas alterações e
            ativação ficam pausadas até reconectar.
          </span>
        </div>
      )}
      {error && (
        <div className="onboarding-error" ref={errorRef} role="alert" tabIndex={-1}>
          <div>
            <strong>{error.title}</strong>
            <p>{error.message}</p>
          </div>
          {!error.sessionEnded && (
            <Button onClick={() => void refresh()} size="sm" variant="secondary">
              {error.action}
            </Button>
          )}
        </div>
      )}
      {pollPaused &&
        snapshot.provisioning &&
        !isTerminalProvisioningState(snapshot.provisioning.state) && (
          <div className="onboarding-error" role="status">
            <div>
              <strong>Acompanhamento pausado</strong>
              <p>
                O limite desta rodada foi atingido. Retome quando quiser consultar a mesma saga.
              </p>
            </div>
            <Button
              onClick={() => {
                setPollAttempt(0);
                setPollPaused(false);
              }}
              size="sm"
              variant="secondary"
            >
              Retomar acompanhamento
            </Button>
          </div>
        )}
      <OnboardingJourney
        busy={busy || locked}
        online={online}
        profileId={profileId}
        snapshot={snapshot}
        unitId={unitId}
        units={units}
        onActivate={() => void activate()}
        onPatch={(input) => void patch(input)}
        onRefresh={() => void refresh()}
        onSelect={(input) => void select(input)}
      />
    </>
  );
}

export function OnboardingJourney({
  snapshot,
  units,
  unitId,
  profileId,
  online,
  busy,
  onRefresh,
  onPatch,
  onSelect,
  onActivate,
}: {
  snapshot: OnboardingResponse;
  units: Unit[];
  unitId: string;
  profileId: ProfileId;
  online: boolean;
  busy: boolean;
  onRefresh: () => void;
  onPatch: (input: OnboardingUpdateInput) => void;
  onSelect: (input: OnboardingSelectionInput) => void;
  onActivate: () => void;
}) {
  const readyCount = CHECKLIST_GROUPS.flatMap((group) => group.items).filter((definition) => {
    const status = snapshot.items[definition.item]?.status;
    return status === "verified" || status === "not_applicable";
  }).length;
  const progress = Math.round((readyCount / 12) * 100);
  const provisioning = snapshot.provisioning;
  const activeProvisioning = provisioning && !isTerminalProvisioningState(provisioning.state);

  return (
    <div className="onboarding-layout">
      <aside className="onboarding-map" aria-label="Mapa do onboarding">
        <div className="onboarding-map__summary">
          <div>
            <strong>{readyCount} de 12 requisitos prontos</strong>
            <span>
              {snapshot.activatedAt ? "Trial ativado pelo servidor" : "O trial ainda não começou"}
            </span>
          </div>
          <Progress label="Progresso confirmado" value={progress} />
        </div>
        <ol>
          {CHECKLIST_GROUPS.map((group) => {
            const groupReady = group.items.filter((item) => {
              const status = snapshot.items[item.item]?.status;
              return status === "verified" || status === "not_applicable";
            }).length;
            return (
              <li key={group.id}>
                <a href={`#onboarding-${group.id}`}>
                  <span aria-hidden="true" className="onboarding-map__count">
                    {groupReady}/{group.items.length}
                  </span>
                  <span>
                    <strong>{group.title}</strong>
                    <small>
                      {groupReady === group.items.length ? "Pronto" : "Em configuração"}
                    </small>
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
        <a className="onboarding-exit" href={routeHref("dashboard")}>
          Explorar o sistema e continuar depois
        </a>
      </aside>

      <div className="onboarding-main">
        {snapshot.activatedAt && (
          <section className="onboarding-complete" aria-labelledby="onboarding-complete-title">
            <span className="onboarding-complete__icon">
              <Icon name="check" />
            </span>
            <div>
              <h2 id="onboarding-complete-title">Operação ativada</h2>
              <p>
                O servidor concluiu o provisionamento e iniciou o trial. Este checklist permanece
                como registro do momento de ativação.
              </p>
            </div>
          </section>
        )}

        {CHECKLIST_GROUPS.map((group) => (
          <section
            aria-labelledby={`onboarding-${group.id}-title`}
            className="onboarding-section"
            id={`onboarding-${group.id}`}
            key={group.id}
          >
            <header>
              <h2 id={`onboarding-${group.id}-title`}>{group.title}</h2>
              <p>{group.description}</p>
            </header>
            <div className="onboarding-section__items">
              {group.items.map((definition) => (
                <ChecklistRow
                  busy={busy || Boolean(activeProvisioning) || Boolean(snapshot.activatedAt)}
                  definition={definition}
                  evidence={snapshot.items[definition.item]}
                  key={definition.item}
                  online={online}
                  profileId={profileId}
                  selection={snapshot.selection}
                  unitId={unitId}
                  units={units}
                  onPatch={onPatch}
                  onRefresh={onRefresh}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </section>
        ))}

        <ActivationPanel
          busy={busy}
          online={online}
          profileId={profileId}
          snapshot={snapshot}
          onActivate={onActivate}
        />
      </div>
    </div>
  );
}

function ChecklistRow({
  definition,
  evidence,
  selection,
  units,
  unitId,
  profileId,
  online,
  busy,
  onRefresh,
  onPatch,
  onSelect,
}: {
  definition: ChecklistDefinition;
  evidence: OnboardingResponse["items"][ChecklistItem];
  selection: OnboardingResponse["selection"];
  units: Unit[];
  unitId: string;
  profileId: ProfileId;
  online: boolean;
  busy: boolean;
  onRefresh: () => void;
  onPatch: (input: OnboardingUpdateInput) => void;
  onSelect: (input: OnboardingSelectionInput) => void;
}) {
  const status = evidence?.status ?? "pending";
  return (
    <article className="onboarding-item" data-status={status}>
      <div className="onboarding-item__identity">
        <span className="onboarding-item__icon">
          <Icon name={definition.icon} />
        </span>
        <div>
          <h3>{definition.label}</h3>
          <p>{definition.why}</p>
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="onboarding-item__detail">
        <p>
          <strong>{statusGuidance(status)}</strong> {definition.recovery}
        </p>
        {evidence?.waiverReason && (
          <p className="onboarding-item__waiver">
            <strong>Justificativa da dispensa:</strong> {evidence.waiverReason}
          </p>
        )}
        <ItemAction
          busy={busy}
          evidence={evidence}
          item={definition.item}
          online={online}
          profileId={profileId}
          selection={selection}
          unitId={unitId}
          units={units}
          onPatch={onPatch}
          onRefresh={onRefresh}
          onSelect={onSelect}
        />
      </div>
    </article>
  );
}

function ItemAction({
  item,
  evidence,
  selection,
  units,
  unitId,
  profileId,
  online,
  busy,
  onRefresh,
  onPatch,
  onSelect,
}: {
  item: ChecklistItem;
  evidence: OnboardingResponse["items"][ChecklistItem];
  selection: OnboardingResponse["selection"];
  units: Unit[];
  unitId: string;
  profileId: ProfileId;
  online: boolean;
  busy: boolean;
  onRefresh: () => void;
  onPatch: (input: OnboardingUpdateInput) => void;
  onSelect: (input: OnboardingSelectionInput) => void;
}) {
  const disabled = busy || !online;
  if (item === "plan") {
    return (
      <SelectionControl
        busy={disabled}
        current={selection}
        profileId={profileId}
        unitId={unitId}
        units={units}
        onSelect={onSelect}
      />
    );
  }
  if (item === "fiscalChoice") {
    return <FiscalControl disabled={disabled} evidence={evidence} onPatch={onPatch} />;
  }
  if (item === "qr") {
    return (
      <QrControl
        disabled={disabled}
        evidence={evidence}
        profileId={profileId}
        onPatch={onPatch}
        onRefresh={onRefresh}
      />
    );
  }
  if (item === "production") {
    return (
      <ProductionControl
        disabled={disabled}
        evidence={evidence}
        onPatch={onPatch}
        onRefresh={onRefresh}
      />
    );
  }
  if (item === "training" || item === "rehearsal") {
    return (
      <AttestationControl disabled={disabled} evidence={evidence} item={item} onPatch={onPatch} />
    );
  }

  const destinations: Partial<Record<ChecklistItem, { route: string; label: string }>> = {
    unit: { route: routeHref("multiunit"), label: "Abrir unidades" },
    catalog: { route: routeHref("catalog"), label: "Abrir Cardápio" },
    tables: { route: routeHref("salon"), label: "Abrir Salão" },
    team: { route: routeHref("people"), label: "Abrir Pessoas" },
    cashier: { route: routeHref("cash"), label: "Abrir Caixa" },
  };
  const destination = destinations[item];
  return (
    <div className="onboarding-item__actions">
      {destination && (
        <a className="onboarding-action-link" href={destination.route}>
          {destination.label}
        </a>
      )}
      <Button disabled={disabled} onClick={onRefresh} size="sm" variant="secondary">
        Atualizar status
      </Button>
    </div>
  );
}

function SelectionControl({
  current,
  units,
  unitId,
  profileId,
  busy,
  onSelect,
}: {
  current: OnboardingResponse["selection"];
  units: Unit[];
  unitId: string;
  profileId: ProfileId;
  busy: boolean;
  onSelect: (input: OnboardingSelectionInput) => void;
}) {
  const [planSlug, setPlanSlug] = useState<OnboardingSelectionInput["planSlug"]>(
    current?.plan.slug ?? "operacao",
  );
  const [selectedUnitId, setSelectedUnitId] = useState(current?.selectedUnitId ?? unitId);
  const [confirmed, setConfirmed] = useState(false);
  const changed = Boolean(
    current && (current.plan.slug !== planSlug || current.selectedUnitId !== selectedUnitId),
  );
  const owner = profileId === "owner";

  return (
    <form
      className="onboarding-inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (owner && (!changed || confirmed)) {
          onSelect({ planSlug, selectedUnitId, reselect: changed });
        }
      }}
    >
      <label>
        Plano publicado
        <select
          disabled={!owner || busy}
          onChange={(event) => {
            setPlanSlug(event.target.value as OnboardingSelectionInput["planSlug"]);
            setConfirmed(false);
          }}
          value={planSlug}
        >
          {PLAN_OPTIONS.map((plan) => (
            <option key={plan.slug} value={plan.slug}>
              {plan.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Unidade da ativação
        <select
          disabled={!owner || busy}
          onChange={(event) => {
            setSelectedUnitId(event.target.value);
            setConfirmed(false);
          }}
          value={selectedUnitId}
        >
          {units.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.name}
            </option>
          ))}
        </select>
      </label>
      {changed && (
        <label className="onboarding-confirmation">
          <input
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            type="checkbox"
          />
          <span>
            Confirmo a reseleção. O servidor fixará uma nova versão de plano e revalidará a
            prontidão desta unidade.
          </span>
        </label>
      )}
      {!owner && <p className="onboarding-owner-note">A seleção exige o proprietário.</p>}
      <Button disabled={!owner || busy || (changed && !confirmed)} size="sm" type="submit">
        {current ? (changed ? "Confirmar reseleção" : "Revalidar seleção") : "Salvar seleção"}
      </Button>
    </form>
  );
}

function FiscalControl({
  disabled,
  evidence,
  onPatch,
}: {
  disabled: boolean;
  evidence: OnboardingResponse["items"][ChecklistItem];
  onPatch: (input: OnboardingUpdateInput) => void;
}) {
  const savedChoice = evidence?.evidence?.choice;
  const initialChoice =
    savedChoice === "focus" || savedChoice === "external" || savedChoice === "disabled"
      ? savedChoice
      : "disabled";
  const [choice, setChoice] = useState<"disabled" | "focus" | "external">(initialChoice);
  if (evidence?.status === "verified") {
    return (
      <p className="onboarding-confirmed">
        Escolha fiscal confirmada pelo servidor: <strong>{initialChoice}</strong>.
      </p>
    );
  }
  return (
    <form
      className="onboarding-inline-form onboarding-inline-form--compact"
      onSubmit={(event) => {
        event.preventDefault();
        onPatch(createAttestationUpdate("fiscalChoice", choice));
      }}
    >
      <label>
        Modo fiscal real
        <select
          disabled={disabled}
          onChange={(event) => setChoice(event.target.value as "disabled" | "focus" | "external")}
          value={choice}
        >
          <option value="disabled">disabled — sem emissão nesta unidade</option>
          <option value="focus">focus — integração ainda depende de credenciais</option>
          <option value="external">external — emissão fora do GiroMesa</option>
        </select>
      </label>
      <p>Escolher Focus ou externo registra a decisão; não simula conexão nem homologação.</p>
      <Button disabled={disabled} size="sm" type="submit">
        Confirmar escolha fiscal
      </Button>
    </form>
  );
}

function QrControl({
  disabled,
  evidence,
  profileId,
  onRefresh,
  onPatch,
}: {
  disabled: boolean;
  evidence: OnboardingResponse["items"][ChecklistItem];
  profileId: ProfileId;
  onRefresh: () => void;
  onPatch: (input: OnboardingUpdateInput) => void;
}) {
  const [reason, setReason] = useState<"pilot_without_qr" | "external_qr" | "not_required">(
    "pilot_without_qr",
  );
  const [waiverReason, setWaiverReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const resolved = evidence?.status === "verified" || evidence?.status === "not_applicable";
  return (
    <div className="onboarding-item__actions onboarding-item__actions--stacked">
      <a className="onboarding-action-link" href={routeHref("catalog")}>
        Revisar menu e QR
      </a>
      <Button disabled={disabled} onClick={onRefresh} size="sm" variant="secondary">
        Atualizar prova do servidor
      </Button>
      {!resolved && profileId === "owner" ? (
        <details className="onboarding-disclosure">
          <summary>Solicitar dispensa de QR</summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (confirmed) onPatch(createQrWaiverUpdate(reason, waiverReason));
            }}
          >
            <p>
              A dispensa fica auditada e não cria capabilities, teste server-side ou QR fictício.
            </p>
            <label>
              Motivo
              <select
                disabled={disabled}
                onChange={(event) =>
                  setReason(
                    event.target.value as "pilot_without_qr" | "external_qr" | "not_required",
                  )
                }
                value={reason}
              >
                <option value="pilot_without_qr">Piloto sem QR</option>
                <option value="external_qr">QR externo</option>
                <option value="not_required">Não necessário</option>
              </select>
            </label>
            <label>
              Justificativa auditável
              <textarea
                aria-describedby="qr-waiver-help"
                disabled={disabled}
                minLength={10}
                onChange={(event) => {
                  setWaiverReason(event.target.value);
                  setConfirmed(false);
                }}
                required
                value={waiverReason}
              />
            </label>
            <small id="qr-waiver-help">Mínimo de 10 caracteres. Não informe segredos.</small>
            <label className="onboarding-confirmation">
              <input
                checked={confirmed}
                disabled={disabled || waiverReason.trim().length < 10}
                onChange={(event) => setConfirmed(event.target.checked)}
                type="checkbox"
              />
              <span>Entendo que esta unidade seguirá sem QR validado pelo GiroMesa.</span>
            </label>
            <Button
              disabled={disabled || !confirmed || waiverReason.trim().length < 10}
              size="sm"
              type="submit"
              variant="secondary"
            >
              Registrar dispensa
            </Button>
          </form>
        </details>
      ) : !resolved ? (
        <p className="onboarding-owner-note">Somente o proprietário pode dispensar QR.</p>
      ) : null}
    </div>
  );
}

function ProductionControl({
  disabled,
  evidence,
  onPatch,
  onRefresh,
}: {
  disabled: boolean;
  evidence: OnboardingResponse["items"][ChecklistItem];
  onPatch: (input: OnboardingUpdateInput) => void;
  onRefresh: () => void;
}) {
  const requestedMode = evidence?.evidence?.requestedMode ?? evidence?.evidence?.mode;
  const initialMode =
    requestedMode === "kds" ||
    requestedMode === "print" ||
    requestedMode === "both" ||
    requestedMode === "off"
      ? requestedMode
      : "off";
  const [mode, setMode] = useState<"off" | "kds" | "print" | "both">(initialMode);
  const kdsStationIds = stringArray(evidence?.evidence?.kdsStationIds);
  const printerProfileIds = stringArray(evidence?.evidence?.printerProfileIds);
  const realEvidenceAvailable =
    (mode === "kds" && kdsStationIds.length > 0) ||
    (mode === "print" && printerProfileIds.length > 0) ||
    (mode === "both" && kdsStationIds.length > 0 && printerProfileIds.length > 0);

  if (evidence?.status === "verified") {
    return (
      <p className="onboarding-confirmed">
        Destino confirmado pelo servidor: <strong>{initialMode}</strong>.
      </p>
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === "off") {
      onPatch(createProductionUpdate({ mode: "off" }));
      return;
    }
    if (!realEvidenceAvailable) return;
    if (mode === "kds") onPatch(createProductionUpdate({ mode, kdsStationIds }));
    if (mode === "print") onPatch(createProductionUpdate({ mode, printerProfileIds }));
    if (mode === "both") {
      onPatch(createProductionUpdate({ mode, kdsStationIds, printerProfileIds }));
    }
  }

  return (
    <form className="onboarding-inline-form onboarding-inline-form--compact" onSubmit={submit}>
      <label>
        Destino dos pedidos
        <select
          disabled={disabled}
          onChange={(event) => setMode(event.target.value as "off" | "kds" | "print" | "both")}
          value={mode}
        >
          <option value="off">off — sem rota de produção</option>
          <option value="kds">kds — tela de produção</option>
          <option value="print">print — impressão</option>
          <option value="both">both — KDS e impressão</option>
        </select>
      </label>
      {mode !== "off" && (
        <p>
          {realEvidenceAvailable
            ? "O servidor retornou identificadores reais. A escolha continuará em andamento até o teste server-side."
            : "Configure estações e perfis reais na Produção. Esta tela não cria identificadores nem marca sucesso."}
        </p>
      )}
      {mode !== "off" && !realEvidenceAvailable && (
        <a className="onboarding-action-link" href={routeHref("kds")}>
          Abrir Produção
        </a>
      )}
      {mode !== "off" && evidence?.status === "in_progress" && (
        <Button disabled={disabled} onClick={onRefresh} size="sm" type="button" variant="secondary">
          Atualizar prova do servidor
        </Button>
      )}
      <Button
        disabled={disabled || (mode !== "off" && !realEvidenceAvailable)}
        size="sm"
        type="submit"
      >
        {mode === "off" ? "Confirmar produção desligada" : "Registrar configuração real"}
      </Button>
    </form>
  );
}

function AttestationControl({
  item,
  disabled,
  evidence,
  onPatch,
}: {
  item: "training" | "rehearsal";
  disabled: boolean;
  evidence: OnboardingResponse["items"][ChecklistItem];
  onPatch: (input: OnboardingUpdateInput) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const label =
    item === "training"
      ? "Confirmo que a equipe praticou acesso, atendimento, produção e caixa."
      : "Confirmo que um pedido percorreu atendimento, produção e conferência do caixa.";
  if (evidence?.status === "verified") {
    return <p className="onboarding-confirmed">Confirmação registrada pelo servidor.</p>;
  }
  return (
    <form
      className="onboarding-attestation"
      onSubmit={(event) => {
        event.preventDefault();
        if (confirmed) onPatch(createAttestationUpdate(item, true));
      }}
    >
      <label className="onboarding-confirmation">
        <input
          checked={confirmed}
          disabled={disabled}
          onChange={(event) => setConfirmed(event.target.checked)}
          type="checkbox"
        />
        <span>{label}</span>
      </label>
      <Button disabled={disabled || !confirmed} size="sm" type="submit">
        {item === "training" ? "Confirmar treinamento" : "Confirmar ensaio"}
      </Button>
    </form>
  );
}

function ActivationPanel({
  snapshot,
  profileId,
  online,
  busy,
  onActivate,
}: {
  snapshot: OnboardingResponse;
  profileId: ProfileId;
  online: boolean;
  busy: boolean;
  onActivate: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const allowed = activationAllowed(snapshot, profileId, online, busy);
  const provisioning = snapshot.provisioning;
  const state = provisioning?.state;
  const retryable = state === "retryable_failed";

  return (
    <section className="onboarding-activation" aria-labelledby="activation-title">
      <div>
        <h2 id="activation-title">Ativar quando a operação estiver pronta</h2>
        <p>
          O trial de 14 dias começa somente no commit final do servidor. Repetir esta tentativa
          reutiliza a mesma chave idempotente e não cria uma segunda assinatura.
        </p>
      </div>
      {provisioning && (
        <div className="onboarding-provisioning" aria-live="polite" role="status">
          <StatusIcon status={provisioningStatusTone(provisioning.state)} />
          <span>
            <strong>{provisioningLabel(provisioning.state)}</strong>
            <small>
              Etapa {provisioning.checkpoint} · tentativa {provisioning.attempts}
            </small>
          </span>
        </div>
      )}
      {!snapshot.ready && (
        <p className="onboarding-activation__blocker">
          Faltam {snapshot.missingItems.length} requisito(s) confirmados pelo servidor.
        </p>
      )}
      {profileId !== "owner" && (
        <p className="onboarding-activation__blocker">
          O gerente pode concluir o checklist, mas somente o proprietário inicia o trial.
        </p>
      )}
      {!snapshot.activatedAt && (
        <label className="onboarding-confirmation onboarding-confirmation--activation">
          <input
            checked={confirmed}
            disabled={!allowed}
            onChange={(event) => setConfirmed(event.target.checked)}
            type="checkbox"
          />
          <span>
            Revisei os 12 requisitos e entendo que o relógio do trial começa após a conclusão da
            saga.
          </span>
        </label>
      )}
      <Button
        disabled={!allowed || !confirmed || Boolean(snapshot.activatedAt)}
        onClick={onActivate}
      >
        {busy
          ? "Enviando tentativa segura..."
          : retryable
            ? "Retomar ativação"
            : snapshot.activatedAt
              ? "Trial ativado"
              : "Ativar trial de 14 dias"}
      </Button>
    </section>
  );
}

function OnboardingLoading() {
  return (
    <div className="onboarding-loading" role="status">
      <span className="gm-sr-only">Carregando onboarding</span>
      <div className="onboarding-loading__map" />
      <div className="onboarding-loading__content">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function PermissionBlock({ message }: { message: string }) {
  return (
    <section className="onboarding-permission" aria-labelledby="onboarding-permission-title">
      <span className="onboarding-permission__icon">
        <Icon name="lock" />
      </span>
      <div>
        <h2 id="onboarding-permission-title">Acesso restrito</h2>
        <p>{message}</p>
        <a className="onboarding-action-link" href={routeHref("dashboard")}>
          Voltar à visão geral
        </a>
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: ChecklistStatus }) {
  const tone =
    status === "verified"
      ? "success"
      : status === "blocked"
        ? "danger"
        : status === "in_progress"
          ? "info"
          : status === "not_applicable"
            ? "neutral"
            : "warning";
  return (
    <Badge tone={tone}>
      <StatusIcon status={status} />
      {statusLabel(status)}
    </Badge>
  );
}

function StatusIcon({ status }: { status: ChecklistStatus }) {
  const path =
    status === "verified"
      ? "M5 12.5 9.2 16.5 19 6.5"
      : status === "in_progress"
        ? "M12 6v6l4 2"
        : status === "blocked"
          ? "M12 8v5M12 17h.01"
          : status === "not_applicable"
            ? "M7 12h10"
            : "M12 7v5";
  return (
    <svg aria-hidden="true" className="onboarding-status-icon" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d={path} />
    </svg>
  );
}

function Icon({ name }: { name: IconName }) {
  const drawings: Record<IconName, ReactNode> = {
    business: <path d="M4 20V7l8-4 8 4v13M8 20v-6h8v6M8 9h.01M12 9h.01M16 9h.01" />,
    unit: (
      <path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Zm0-8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
    ),
    plan: <path d="M4 5h11l5 5-10 10-6-6V5Zm4 4h.01" />,
    fiscal: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6M9 12h6M9 16h4" />,
    catalog: (
      <path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v17H7.5A3.5 3.5 0 0 0 4 22V5.5ZM20 5.5A3.5 3.5 0 0 0 16.5 2H13v17h3.5A3.5 3.5 0 0 1 20 22V5.5Z" />
    ),
    tables: <path d="M5 10h14M7 10v9M17 10v9M8 5h8l2 5H6l2-5Z" />,
    team: (
      <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-1a3 3 0 1 0 0-6M2 21a7 7 0 0 1 14 0M15 14a6 6 0 0 1 7 6" />
    ),
    qr: (
      <path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h2v2h-2v-2Zm4 0h2v6h-6v-2h4v-4Z" />
    ),
    production: <path d="M5 3v7a3 3 0 0 0 3 3V3M8 13v8M16 3v18M16 3c3 2 4 5 4 8h-4" />,
    cashier: <path d="M4 7h16v12H4V7Zm3-3h10v3M7 11h4v4H7v-4Zm7 0h3M14 15h3" />,
    training: <path d="m3 8 9-5 9 5-9 5-9-5Zm4 3v5c3 3 7 3 10 0v-5M21 8v6" />,
    rehearsal: <path d="M5 3h14v18H5V3Zm4 5 2 2 4-4M9 15h6" />,
    lock: <path d="M6 10h12v11H6V10Zm3 0V7a3 3 0 0 1 6 0v3M12 14v3" />,
    refresh: (
      <path d="M20 7v5h-5M4 17v-5h5M6.1 8a7 7 0 0 1 11.5-2.2L20 8M4 16l2.4 2.2A7 7 0 0 0 18 16" />
    ),
    check: <path d="m5 12 4 4L19 6" />,
  };
  return (
    <svg aria-hidden="true" className="onboarding-icon-svg" viewBox="0 0 24 24">
      {drawings[name]}
    </svg>
  );
}

function statusLabel(status: ChecklistStatus): string {
  return {
    pending: "Pendente",
    in_progress: "Em andamento",
    verified: "Verificado",
    blocked: "Bloqueado",
    not_applicable: "Dispensado",
  }[status];
}

function statusGuidance(status: ChecklistStatus): string {
  return {
    pending: "Ainda não iniciado.",
    in_progress: "Há trabalho salvo, mas ainda falta verificação.",
    verified: "Evidência aceita pelo servidor.",
    blocked: "Existe um bloqueio que precisa de recuperação.",
    not_applicable: "Dispensa autorizada e auditável.",
  }[status];
}

function provisioningLabel(state: ProvisioningState): string {
  return {
    requested: "Ativação solicitada",
    validating: "Validando requisitos",
    provisioning: "Provisionando recursos internos",
    activating: "Ativando trial e entitlements",
    publishing: "Publicando conclusão",
    retryable_failed: "Tentativa pronta para retomada",
    compensating: "Compensando recursos provisórios",
    compensated: "Ativação compensada",
    terminal_failed: "Ativação encerrada com falha",
    completed: "Ativação concluída",
  }[state];
}

function provisioningStatusTone(state: ProvisioningState): ChecklistStatus {
  if (state === "completed") return "verified";
  if (state === "terminal_failed" || state === "compensated") return "blocked";
  if (state === "retryable_failed") return "pending";
  return "in_progress";
}

function browserSessionStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    const storage = window.sessionStorage;
    const probe = "giromesa:onboarding:storage-probe";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
