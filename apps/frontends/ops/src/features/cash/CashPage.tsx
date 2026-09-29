// biome-ignore-all lint/a11y/noLabelWithoutControl: shadcn-compatible controls render native form elements nested by these labels
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  Icon,
  Input,
  Modal,
  NativeSelect,
  StatusDot,
} from "@giromesa/ui";
import { type FormEvent, useEffect, useState } from "react";
import { ApiClientError, api } from "../../api";
import {
  currencyToCents,
  dateLabel,
  formatCurrencyInput,
  type ManagementScope,
  operationalKey,
  parseCash,
  parseCashClosure,
  RemoteGate,
  useRemote,
} from "../../management.shared";
import { formatMoney } from "../../rules";
import { CashAdministrationPanels } from "./CashAdministrationPanels";
import { CashClosureReceipt } from "./CashClosureReceipt";
import { CashHistoryPanel } from "./CashHistoryPanel";
import {
  cashEntryLabel,
  paymentMethodLabel,
  summarizeCashEntries,
  visibleCashAlerts,
} from "./cash";
import "./cash.css";

type BusyAction = "open" | "movement" | "close" | "review" | "register" | "transfer" | null;
type CashWorkspaceView = "shift" | "ledger" | "history" | "settings";

const QUICK_OPENING_AMOUNTS = [
  { label: "R$ 50", value: "50,00" },
  { label: "R$ 100", value: "100,00" },
  { label: "R$ 150", value: "150,00" },
  { label: "R$ 200", value: "200,00" },
  { label: "R$ 300", value: "300,00" },
];

const BRL_DENOMINATIONS = [
  { label: "R$ 200", cents: 20000, type: "bill" },
  { label: "R$ 100", cents: 10000, type: "bill" },
  { label: "R$ 50", cents: 5000, type: "bill" },
  { label: "R$ 20", cents: 2000, type: "bill" },
  { label: "R$ 10", cents: 1000, type: "bill" },
  { label: "R$ 5", cents: 500, type: "bill" },
  { label: "R$ 2", cents: 200, type: "bill" },
  { label: "R$ 1", cents: 100, type: "coin" },
  { label: "R$ 0,50", cents: 50, type: "coin" },
  { label: "R$ 0,25", cents: 25, type: "coin" },
  { label: "R$ 0,10", cents: 10, type: "coin" },
  { label: "R$ 0,05", cents: 5, type: "coin" },
] as const;

function useOnline() {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

export function RealCashPage({
  scope,
  identityId,
}: {
  scope: ManagementScope;
  identityId?: string;
}) {
  const remote = useRemote(scope, api.management.cashShifts, parseCash);
  const online = useOnline();
  const [opening, setOpening] = useState("");
  const [selectedRegisterId, setSelectedRegisterId] = useState("");
  const [registerName, setRegisterName] = useState("");
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [showRegisters, setShowRegisters] = useState(false);
  const [editingRegisterId, setEditingRegisterId] = useState("");
  const [editingRegisterName, setEditingRegisterName] = useState("");
  const [transferToShiftId, setTransferToShiftId] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [busy, setBusy] = useState<BusyAction>(null);
  const [feedback, setFeedback] = useState("");
  const [actionError, setActionError] = useState("");
  const [movementType, setMovementType] = useState<"supply" | "withdrawal">("withdrawal");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementReason, setMovementReason] = useState("");
  const [counted, setCounted] = useState("");
  const [tenderCounts, setTenderCounts] = useState<Record<string, string>>({});
  const [closeReason, setCloseReason] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [lastClosure, setLastClosure] = useState<ReturnType<typeof parseCashClosure> | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [restrictedReviews, setRestrictedReviews] = useState<string[]>([]);
  const [activeView, setActiveView] = useState<CashWorkspaceView>("shift");
  const [activeActionPanel, setActiveActionPanel] = useState<
    "close" | "movement" | "transfer" | null
  >(null);
  const [ledgerFilter, setLedgerFilter] = useState<"all" | "in" | "out">("all");

  // Novas funcionalidades reais
  const [pendingTabsExpanded, setPendingTabsExpanded] = useState(false);
  const [showDenominationCalculator, setShowDenominationCalculator] = useState(false);
  const [denominationCounts, setDenominationCounts] = useState<Record<number, number>>({});
  const [showReceiptModal, setShowReceiptModal] = useState(false);

  function selectRegister(cashRegisterId: string) {
    setSelectedRegisterId(cashRegisterId);
    setLastClosure(null);
    setShowReceiptModal(false);
    setMovementAmount("");
    setMovementReason("");
    setTransferToShiftId("");
    setTransferAmount("");
    setTransferReason("");
    setCounted("");
    setTenderCounts({});
    setCloseReason("");
    setConfirmClose(false);
    setReviewNote("");
    setFeedback("");
    setActionError("");
    setActiveActionPanel(null);
    setDenominationCounts({});
    setShowDenominationCalculator(false);
  }

  function begin(action: Exclude<BusyAction, null>) {
    setFeedback("");
    setActionError("");
    if (!online) {
      setActionError("Sem conexão. Reconecte para alterar o caixa com segurança.");
      return false;
    }
    setBusy(action);
    return true;
  }

  function updateDenomination(cents: number, rawValue: string) {
    const qty = Math.max(0, Number.parseInt(rawValue || "0", 10) || 0);
    const updated = { ...denominationCounts, [cents]: qty };
    setDenominationCounts(updated);
    const totalCents = BRL_DENOMINATIONS.reduce(
      (sum, d) => sum + (updated[d.cents] ?? 0) * d.cents,
      0,
    );
    setCounted(formatCurrencyInput((totalCents / 100).toFixed(2)));
    setConfirmClose(false);
  }

  function clearDenominations() {
    setDenominationCounts({});
    setCounted("");
    setConfirmClose(false);
  }

  async function openShift(event: FormEvent, cashRegisterId: string) {
    event.preventDefault();
    const cents = currencyToCents(opening);
    if (!Number.isFinite(cents) || cents < 0) {
      setActionError("Informe um fundo de caixa válido.");
      return;
    }
    if (!begin("open")) return;
    try {
      await api.management.openCashShift(
        scope.organizationId,
        scope.unitId,
        cents,
        operationalKey("cash-open"),
        cashRegisterId,
      );
      setOpening("");
      setLastClosure(null);
      setFeedback("Caixa aberto com sucesso.");
      setActiveActionPanel(null);
      remote.retry();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Não foi possível abrir o caixa.");
    } finally {
      setBusy(null);
    }
  }

  async function createRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (registerName.trim().length < 2) {
      setActionError("Informe um nome para a gaveta.");
      return;
    }
    if (!begin("register")) return;
    try {
      await api.management.createCashRegister(
        scope.organizationId,
        scope.unitId,
        registerName.trim(),
        operationalKey("cash-register"),
      );
      setRegisterName("");
      setShowRegisterForm(false);
      setFeedback("Gaveta criada.");
      remote.retry();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Não foi possível criar a gaveta.");
    } finally {
      setBusy(null);
    }
  }

  async function toggleRegister(cashRegisterId: string, active: boolean) {
    if (!begin("register")) return;
    try {
      await api.management.updateCashRegister(
        scope.organizationId,
        scope.unitId,
        cashRegisterId,
        { active },
        operationalKey("cash-register-update"),
      );
      setFeedback(active ? "Gaveta ativada." : "Gaveta desativada.");
      remote.retry();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Não foi possível atualizar a gaveta.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function renameRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingRegisterId || editingRegisterName.trim().length < 2) {
      setActionError("Selecione a gaveta e informe o novo nome.");
      return;
    }
    if (!begin("register")) return;
    try {
      await api.management.updateCashRegister(
        scope.organizationId,
        scope.unitId,
        editingRegisterId,
        { name: editingRegisterName.trim() },
        operationalKey("cash-register-rename"),
      );
      setEditingRegisterId("");
      setEditingRegisterName("");
      setFeedback("Gaveta renomeada.");
      remote.retry();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Não foi possível renomear a gaveta.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function transferCash(event: FormEvent<HTMLFormElement>, fromCashShiftId: string) {
    event.preventDefault();
    const amountCents = currencyToCents(transferAmount);
    if (!transferToShiftId || amountCents <= 0 || transferReason.trim().length < 3) {
      setActionError("Informe destino, valor e motivo da transferência.");
      return;
    }
    if (!begin("transfer")) return;
    try {
      const response = await api.management.transferCash(
        scope.organizationId,
        scope.unitId,
        {
          fromCashShiftId,
          toCashShiftId: transferToShiftId,
          amountCents,
          reason: transferReason.trim(),
        },
        operationalKey("cash-transfer"),
      );
      setTransferToShiftId("");
      setTransferAmount("");
      setTransferReason("");
      setActiveActionPanel(null);
      setFeedback(
        isPendingApproval(response)
          ? "Transferência enviada para aprovação."
          : "Transferência enviada; aguardando aceite do responsável pelo destino.",
      );
      remote.retry();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Não foi possível transferir o valor.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function addMovement(event: FormEvent<HTMLFormElement>, shiftId: string) {
    event.preventDefault();
    const amountCents = currencyToCents(movementAmount);
    if (amountCents <= 0 || movementReason.trim().length < 3) {
      setActionError("Informe valor e motivo do movimento.");
      return;
    }
    if (!begin("movement")) return;
    try {
      const response = await api.management.addCashMovement(
        scope.organizationId,
        scope.unitId,
        shiftId,
        { type: movementType, amountCents, reason: movementReason.trim() },
        operationalKey("cash-movement"),
      );
      setMovementAmount("");
      setMovementReason("");
      setActiveActionPanel(null);
      setFeedback(
        isPendingApproval(response)
          ? "Movimento enviado para aprovação."
          : movementType === "supply"
            ? "Suprimento registrado."
            : "Sangria registrada.",
      );
      remote.retry();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Não foi possível registrar o movimento.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function closeShift(event: FormEvent<HTMLFormElement>, shiftId: string, methods: string[]) {
    event.preventDefault();
    const countedCents = currencyToCents(counted);
    if (countedCents < 0) {
      setActionError("Informe o valor contado no caixa.");
      return;
    }
    const observed = methods.map((method) => ({
      method,
      observedCents: method === "cash" ? countedCents : currencyToCents(tenderCounts[method] ?? ""),
      source: "manual" as const,
    }));
    if (observed.some((count) => count.observedCents < 0)) {
      setActionError("Informe o valor conferido para cada forma de pagamento.");
      return;
    }
    if (!confirmClose) {
      setActionError("");
      setConfirmClose(true);
      return;
    }
    if (!begin("close")) return;
    try {
      const response = await api.management.closeCashShift(
        scope.organizationId,
        scope.unitId,
        shiftId,
        {
          countedCents,
          closeReason: closeReason.trim() || undefined,
          tenderCounts: observed,
        },
        operationalKey("cash-close"),
      );
      setLastClosure(parseCashClosure(response));
      setCounted("");
      setTenderCounts({});
      setCloseReason("");
      setConfirmClose(false);
      setActiveActionPanel(null);
      setShowDenominationCalculator(false);
      setDenominationCounts({});
      setFeedback("Caixa fechado com sucesso. Confira o resultado da conferência abaixo.");
      remote.retry();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Não foi possível fechar o caixa.");
    } finally {
      setBusy(null);
    }
  }

  async function reviewShift(event: FormEvent<HTMLFormElement>, shiftId: string) {
    event.preventDefault();
    if (reviewNote.trim().length < 3) {
      setActionError("Informe uma justificativa para concluir a revisão.");
      return;
    }
    if (!begin("review")) return;
    try {
      await api.management.reviewCashShift(
        scope.organizationId,
        scope.unitId,
        shiftId,
        reviewNote.trim(),
        operationalKey("cash-review"),
      );
      setReviewNote("");
      setFeedback("Divergência revisada e auditada.");
      remote.retry();
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        error.code === "CASH_SHIFT_REVIEW_DUAL_CONTROL_REQUIRED"
      ) {
        setRestrictedReviews((current) => [...current, `${identityId ?? ""}:${shiftId}`]);
        setActionError("");
      } else {
        setActionError(
          error instanceof Error ? error.message : "Não foi possível revisar o caixa.",
        );
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <RemoteGate remote={remote}>
      {(data) => {
        const activeRegisters = data.registers.filter((cashRegister) => cashRegister.active);
        const openShifts = data.shifts.filter((shift) => shift.status === "open");
        const selectedRegister =
          data.registers.find((cashRegister) => cashRegister.id === selectedRegisterId) ??
          activeRegisters.find((cashRegister) => cashRegister.openShiftId) ??
          activeRegisters[0] ??
          data.registers[0];
        const open = openShifts.find((shift) => shift.cashRegisterId === selectedRegister?.id);
        const closed = data.shifts.filter(
          (shift) => shift.status !== "open" && shift.cashRegisterId === selectedRegister?.id,
        );
        const reviewCandidate = closed.find(
          (shift) => shift.status === "closed" && shift.differenceSeverity !== "none",
        );
        const reviewRequiresAnotherManager = Boolean(
          reviewCandidate &&
            ((identityId && reviewCandidate.currentResponsibleIdentityId === identityId) ||
              restrictedReviews.includes(`${identityId ?? ""}:${reviewCandidate.id}`)),
        );
        const entries = open ? data.entries.filter((entry) => entry.cashShiftId === open.id) : [];
        const summary = summarizeCashEntries(entries);
        const closeMethods = [
          "cash",
          ...[...summary.byMethod.keys()].filter((method) => method !== "cash"),
        ];
        const consolidatedExpected = openShifts.reduce(
          (sum, shift) => sum + (shift.expectedCents ?? 0),
          0,
        );
        const totalPendingTabsCents = data.pendingTabs.reduce(
          (sum, tab) => sum + tab.remainingCents,
          0,
        );
        const alerts = visibleCashAlerts(data);

        const filteredEntries = entries.filter((entry) => {
          if (ledgerFilter === "in") return entry.direction === "in";
          if (ledgerFilter === "out") return entry.direction === "out";
          return true;
        });

        return (
          <div className="cash-page growth-stack">
            <header className="cash-page-header gm-toolbar">
              <div>
                <h1>Contas e caixa</h1>
                <p>
                  {openShifts.length === 1
                    ? "1 caixa aberto"
                    : `${openShifts.length} caixas abertos`}
                  {openShifts.length > 1 && data.capabilities.canViewExpected && (
                    <> · Total da unidade {formatMoney(consolidatedExpected)}</>
                  )}
                </p>
              </div>
              <div className="cash-page-header__actions">
                {data.registers.length > 0 && (
                  <label className="cash-register-picker">
                    Gaveta
                    <NativeSelect
                      aria-label="Gaveta em uso"
                      disabled={busy !== null}
                      onChange={(event) => selectRegister(event.target.value)}
                      value={selectedRegister?.id ?? ""}
                    >
                      {data.registers.map((register) => (
                        <option key={register.id} value={register.id}>
                          {register.name} ·{" "}
                          {register.openShiftId
                            ? "Aberto"
                            : register.active
                              ? "Fechado"
                              : "Inativo"}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                )}
                {data.capabilities.canManageRegisters && (
                  <Button
                    onClick={() => {
                      setActionError("");
                      setShowRegisters(true);
                    }}
                    size="sm"
                    variant="secondary"
                  >
                    <Icon name="settings" size={14} />
                    Gavetas
                  </Button>
                )}
              </div>
            </header>
            {!online && (
              <p className="cash-notice cash-notice--warning" role="alert">
                Sem conexão. Reconecte para abrir, movimentar ou fechar o caixa.
              </p>
            )}

            {/* ALERTAS OPERACIONAIS EM DESTAQUE NO TOPO */}
            {activeView === "shift" && alerts.length > 0 && (
              <div className="cash-top-alerts">
                {alerts.map((alert) => (
                  <Callout
                    key={JSON.stringify(alert)}
                    tone={alert.severity === "critical" ? "danger" : "warning"}
                  >
                    <div className="cash-top-alert-content">
                      <Icon name="alert-circle" />
                      <div>
                        <strong>
                          {alert.severity === "critical" ? "Alerta de caixa" : "Atenção"}
                        </strong>
                        <p>{alert.message}</p>
                      </div>
                    </div>
                  </Callout>
                ))}
              </div>
            )}

            {actionError && !activeActionPanel && !showRegisters && (
              <p className="auth-message auth-message--error" role="alert">
                {actionError}
              </p>
            )}
            {feedback && (
              <p className="form-feedback" role="status">
                {feedback}
              </p>
            )}

            {/* SELETOR DE GAVETAS FÍSICAS */}
            <Modal
              className="cash-modal"
              closeDisabled={busy !== null}
              isOpen={showRegisters}
              onClose={() => setShowRegisters(false)}
              size="lg"
              title="Gavetas da unidade"
            >
              <div className="cash-registers">
                <div className="card-header">
                  <div className="cash-register-header__actions">
                    <Badge tone={openShifts.length > 0 ? "success" : "neutral"}>
                      {openShifts.length === 1 ? "1 aberto" : `${openShifts.length} abertos`}
                    </Badge>
                    {data.capabilities.canManageRegisters && (
                      <Button
                        disabled={busy !== null || !online}
                        onClick={() => {
                          setShowRegisterForm((visible) => !visible);
                          setEditingRegisterId("");
                          setEditingRegisterName("");
                        }}
                        size="sm"
                        type="button"
                        variant="secondary"
                      >
                        {showRegisterForm ? "Cancelar" : "Adicionar gaveta"}
                      </Button>
                    )}
                  </div>
                </div>
                {actionError && (
                  <p className="auth-message auth-message--error" role="alert">
                    {actionError}
                  </p>
                )}
                {feedback && (
                  <p className="form-feedback" role="status">
                    {feedback}
                  </p>
                )}

                {showRegisterForm && data.capabilities.canManageRegisters && (
                  <form className="cash-register-create" onSubmit={createRegister}>
                    <label>
                      Nome da gaveta
                      <Input
                        maxLength={120}
                        onChange={(event) => setRegisterName(event.target.value)}
                        placeholder="Ex.: Bar"
                        value={registerName}
                      />
                    </label>
                    <Button disabled={busy !== null || !online} type="submit">
                      {busy === "register" ? "Salvando…" : "Salvar gaveta"}
                    </Button>
                  </form>
                )}

                {data.registers.length > 0 ? (
                  <div className="cash-register-grid">
                    {data.registers.map((cashRegister) => {
                      const shift = openShifts.find(
                        (candidate) => candidate.cashRegisterId === cashRegister.id,
                      );
                      const selected = selectedRegister?.id === cashRegister.id;
                      return (
                        <article
                          className="cash-register-card"
                          data-selected={selected}
                          key={cashRegister.id}
                        >
                          <Button
                            aria-label={`Selecionar ${cashRegister.name}, ${
                              shift ? "aberto" : cashRegister.active ? "fechado" : "inativo"
                            }`}
                            aria-pressed={selected}
                            className="cash-register-card__select"
                            disabled={busy !== null}
                            onClick={() => {
                              selectRegister(cashRegister.id);
                              setShowRegisters(false);
                            }}
                            type="button"
                            variant="ghost"
                          >
                            <span className="cash-register-card__title">
                              <span className="cash-register-card__status-line">
                                <StatusDot
                                  pulse={Boolean(shift)}
                                  tone={
                                    shift ? "success" : cashRegister.active ? "neutral" : "warning"
                                  }
                                />
                                <strong>{cashRegister.name}</strong>
                              </span>
                              <Badge
                                tone={
                                  shift ? "success" : cashRegister.active ? "neutral" : "warning"
                                }
                              >
                                {shift ? "Aberto" : cashRegister.active ? "Fechado" : "Inativo"}
                              </Badge>
                            </span>
                            <small className="cash-register-card__operator">
                              {shift
                                ? `Responsável: ${
                                    shift.responsibleName ?? shift.operatorName ?? "não informado"
                                  }`
                                : cashRegister.active
                                  ? "Disponível para abertura"
                                  : "Fora de uso"}
                            </small>
                            {shift?.openedAt && (
                              <small className="cash-register-card__time">
                                Desde {dateLabel(shift.openedAt)}
                              </small>
                            )}
                          </Button>
                          {data.capabilities.canManageRegisters && (
                            <fieldset
                              className="cash-register-menu__content"
                              aria-label={`Ações da gaveta ${cashRegister.name}`}
                            >
                              <Button
                                disabled={busy !== null || !online}
                                onClick={() => {
                                  setShowRegisterForm(false);
                                  setEditingRegisterId(cashRegister.id);
                                  setEditingRegisterName(cashRegister.name);
                                }}
                                size="sm"
                                type="button"
                                variant="ghost"
                              >
                                Renomear
                              </Button>
                              <Button
                                disabled={busy !== null || !online || Boolean(shift)}
                                onClick={() =>
                                  void toggleRegister(cashRegister.id, !cashRegister.active)
                                }
                                size="sm"
                                type="button"
                                variant={cashRegister.active ? "danger" : "ghost"}
                              >
                                {cashRegister.active ? "Desativar" : "Ativar"}
                              </Button>
                              {shift && <small>Feche o caixa para desativar.</small>}
                            </fieldset>
                          )}
                          {editingRegisterId === cashRegister.id && (
                            <form className="cash-register-rename" onSubmit={renameRegister}>
                              <label>
                                Novo nome
                                <Input
                                  maxLength={120}
                                  onChange={(event) => setEditingRegisterName(event.target.value)}
                                  value={editingRegisterName}
                                />
                              </label>
                              <div className="cash-register-rename__actions">
                                <Button disabled={busy !== null || !online} size="sm" type="submit">
                                  {busy === "register" ? "Salvando…" : "Salvar nome"}
                                </Button>
                                <Button
                                  onClick={() => {
                                    setEditingRegisterId("");
                                    setEditingRegisterName("");
                                  }}
                                  size="sm"
                                  type="button"
                                  variant="ghost"
                                >
                                  Cancelar
                                </Button>
                              </div>
                            </form>
                          )}
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState
                    description="Cadastre a primeira gaveta física desta unidade."
                    icon="$"
                    title="Nenhuma gaveta cadastrada"
                  />
                )}
              </div>
            </Modal>

            <nav className="cash-workspace-tabs" aria-label="Áreas do caixa">
              {(
                [
                  ["shift", "Turno"],
                  ["ledger", "Extrato"],
                  ["history", "Histórico"],
                  ["settings", "Configurações"],
                ] as const
              )
                .filter(
                  ([view]) =>
                    view !== "settings" ||
                    data.capabilities.canManageCashSettings ||
                    data.capabilities.canManageTerminals,
                )
                .map(([view, label]) => (
                  <Button
                    aria-current={activeView === view ? "page" : undefined}
                    className="cash-workspace-tabs__item"
                    data-active={activeView === view}
                    key={view}
                    onClick={() => {
                      setActiveView(view);
                      setActiveActionPanel(null);
                      setConfirmClose(false);
                    }}
                    type="button"
                    variant="ghost"
                    size="sm"
                  >
                    {label}
                    {view === "history" && reviewCandidate && data.capabilities.canReview && (
                      <Badge tone="warning">Revisar</Badge>
                    )}
                  </Button>
                ))}
            </nav>

            {activeView === "shift" && lastClosure && (
              <Card aria-live="polite" className="cash-result">
                <div className="card-header">
                  <div>
                    <p className="eyebrow">Fechamento concluído</p>
                    <h2>Resultado da conferência</h2>
                  </div>
                  <div className="cash-result__header-actions">
                    <Button
                      onClick={() => setShowReceiptModal(true)}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      <Icon name="download" />
                      Imprimir Comprovante
                    </Button>
                    <Badge tone={lastClosure.reviewRequired ? "warning" : "success"}>
                      {lastClosure.reviewRequired ? "Revisão necessária" : "Sem diferença"}
                    </Badge>
                  </div>
                </div>
                <div className="cash-result__values">
                  <span>
                    <small>Esperado</small>
                    <strong>{formatMoney(lastClosure.expectedCents)}</strong>
                  </span>
                  <span>
                    <small>Contado</small>
                    <strong>{formatMoney(lastClosure.countedCents)}</strong>
                  </span>
                  <span>
                    <small>Diferença</small>
                    <strong>{formatMoney(lastClosure.differenceCents)}</strong>
                  </span>
                </div>
                {lastClosure.breakdown.length > 0 && (
                  <div className="cash-methods">
                    {lastClosure.breakdown.map((item) => (
                      <span key={item.method}>
                        <small>{paymentMethodLabel(item.method)}</small>
                        <strong>{formatMoney(item.amountCents)}</strong>
                      </span>
                    ))}
                  </div>
                )}
                {lastClosure.tenderBreakdown.length > 0 && (
                  <div className="cash-tender-result">
                    {lastClosure.tenderBreakdown.map((item) => (
                      <span key={item.method}>
                        <strong>{paymentMethodLabel(item.method)}</strong>
                        <small>
                          Esperado {formatMoney(item.expectedCents)} · conferido{" "}
                          {formatMoney(item.observedCents)} · diferença{" "}
                          {formatMoney(item.differenceCents)}
                        </small>
                      </span>
                    ))}
                  </div>
                )}
              </Card>
            )}

            {open ? (
              <>
                {/* BARRA DE OPERAÇÃO DO TURNO ABERTO COM DESTAQUE PARA FECHAMENTO */}
                <div className="cash-operation-header" hidden={activeView !== "shift"}>
                  <div className="cash-operation-header__info">
                    <div className="cash-operation-header__title-row">
                      <StatusDot pulse tone="success" />
                      <span className="cash-operation-header__tag">Turno Aberto</span>
                      <h2 className="cash-operation-header__drawer-name">
                        {selectedRegister?.name}
                      </h2>
                    </div>
                    <p className="cash-operation-header__meta">
                      Operador:{" "}
                      <strong>
                        {open.responsibleName ?? open.operatorName ?? "Operador identificado"}
                      </strong>{" "}
                      · Desde {dateLabel(open.openedAt)}
                    </p>
                  </div>

                  <div className="cash-operation-header__actions">
                    {data.capabilities.canClose && (
                      <Button
                        onClick={() => {
                          setActionError("");
                          setActiveActionPanel((curr) => (curr === "close" ? null : "close"));
                          setConfirmClose(false);
                        }}
                        size="sm"
                        type="button"
                        variant="secondary"
                      >
                        <Icon name="check" />
                        Fechar caixa
                      </Button>
                    )}
                    {data.capabilities.canMove && (
                      <>
                        <Button
                          className={
                            activeActionPanel === "movement" && movementType === "withdrawal"
                              ? "cash-btn-quick--active"
                              : ""
                          }
                          onClick={() => {
                            setActionError("");
                            setMovementType("withdrawal");
                            setActiveActionPanel((curr) =>
                              curr === "movement" && movementType === "withdrawal"
                                ? null
                                : "movement",
                            );
                          }}
                          size="sm"
                          type="button"
                          variant="secondary"
                        >
                          <Icon name="minus" />
                          Sangria
                        </Button>
                        <Button
                          className={
                            activeActionPanel === "movement" && movementType === "supply"
                              ? "cash-btn-quick--active"
                              : ""
                          }
                          onClick={() => {
                            setActionError("");
                            setMovementType("supply");
                            setActiveActionPanel((curr) =>
                              curr === "movement" && movementType === "supply" ? null : "movement",
                            );
                          }}
                          size="sm"
                          type="button"
                          variant="secondary"
                        >
                          <Icon name="plus" />
                          Suprimento
                        </Button>
                      </>
                    )}
                    {data.capabilities.canTransfer && openShifts.length > 1 && (
                      <Button
                        className={activeActionPanel === "transfer" ? "cash-btn-quick--active" : ""}
                        onClick={() => {
                          setActionError("");
                          setActiveActionPanel((curr) => (curr === "transfer" ? null : "transfer"));
                        }}
                        size="sm"
                        type="button"
                        variant="secondary"
                      >
                        <Icon name="refresh" />
                        Transferir
                      </Button>
                    )}
                  </div>
                </div>

                {/* MÉTRICAS PRINCIPAIS DO TURNO */}
                <div className="metrics-grid" hidden={activeView !== "shift"}>
                  <Card className="metric-card">
                    <p>Dinheiro na gaveta</p>
                    <strong>
                      {data.capabilities.canViewExpected && open.expectedCents !== null
                        ? formatMoney(open.expectedCents)
                        : "Contagem cega"}
                    </strong>
                    <small>
                      {data.capabilities.canViewExpected
                        ? `${formatMoney(open.openingCents)} de fundo inicial`
                        : "O esperado será revelado após o fechamento"}
                    </small>
                  </Card>
                  <Card className="metric-card">
                    <p>Fluxo físico</p>
                    <strong>{formatMoney(summary.drawerInCents - summary.drawerOutCents)}</strong>
                    <small>
                      {formatMoney(summary.drawerInCents)} entrou ·{" "}
                      {formatMoney(summary.drawerOutCents)} saiu
                    </small>
                  </Card>
                </div>

                {/* ALERTA PREVENTIVO DE COMANDAS PENDENTES COM DETALHAMENTO REAL */}
                {activeView === "shift" && data.pendingTabs.length > 0 && (
                  <Callout tone="warning">
                    <div className="cash-pending-banner">
                      <div className="cash-pending-banner__text">
                        <div className="cash-pending-banner__header">
                          <Icon name="alert-circle" />
                          <strong>
                            {data.pendingTabs.length}{" "}
                            {data.pendingTabs.length === 1
                              ? "comanda a receber"
                              : "comandas a receber"}{" "}
                            · {formatMoney(totalPendingTabsCents)}
                          </strong>
                        </div>
                        <p>Recebimentos após o fechamento entram no próximo turno.</p>
                      </div>
                      <div className="cash-pending-banner__actions">
                        <Button
                          aria-expanded={pendingTabsExpanded}
                          onClick={() => setPendingTabsExpanded((prev) => !prev)}
                          size="sm"
                          type="button"
                          variant="secondary"
                        >
                          {pendingTabsExpanded ? "Ocultar comandas" : "Ver comandas"}
                        </Button>
                        <a
                          className="button button--secondary cash-pending-action"
                          href="#/counter"
                        >
                          Ir para balcão
                        </a>
                      </div>
                    </div>

                    {pendingTabsExpanded && (
                      <div className="cash-pending-tabs-list">
                        {data.pendingTabs.map((tab) => (
                          <div className="cash-pending-tab-item" key={tab.id}>
                            <div className="cash-pending-tab-item__info">
                              <strong>{tab.label}</strong>
                              <small>
                                Consumo total: {formatMoney(tab.totalCents)} · Já pago:{" "}
                                {formatMoney(tab.paidCents)}
                              </small>
                            </div>
                            <div className="cash-pending-tab-item__action">
                              <Badge tone="warning">Saldo: {formatMoney(tab.remainingCents)}</Badge>
                              <a
                                className="button button--sm button--secondary"
                                href={`#/counter?tab=${encodeURIComponent(tab.id)}`}
                              >
                                Cobrar no balcão
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Callout>
                )}

                {/* PAINEL PROEMINENTE DE FECHAMENTO DE CAIXA COM CALCULADORA DE CÉDULAS */}
                <Modal
                  className="cash-modal"
                  closeDisabled={busy !== null}
                  isOpen={activeActionPanel !== null}
                  onClose={() => {
                    setActiveActionPanel(null);
                    setConfirmClose(false);
                  }}
                  size={activeActionPanel === "close" ? "lg" : "md"}
                  title={
                    activeActionPanel === "close"
                      ? "Fechar caixa"
                      : activeActionPanel === "transfer"
                        ? "Transferir entre gavetas"
                        : movementType === "supply"
                          ? "Suprimento"
                          : "Sangria"
                  }
                >
                  {actionError && (
                    <p className="auth-message auth-message--error" role="alert">
                      {actionError}
                    </p>
                  )}
                  {data.capabilities.canClose && activeActionPanel === "close" && (
                    <div id="cash-closure-panel">
                      <p className="cash-card-desc">
                        {data.capabilities.canViewExpected
                          ? "Confira o dinheiro e os recebimentos antes de encerrar."
                          : "Contagem cega: o esperado aparece após o fechamento."}
                      </p>

                      <form
                        className="cash-closure-form"
                        onSubmit={(event) => void closeShift(event, open.id, closeMethods)}
                      >
                        <div className="cash-closure-step">
                          <div className="cash-closure-step__header">
                            <span className="cash-step-number">1</span>
                            <div>
                              <strong>Dinheiro na gaveta</strong>
                            </div>
                            <Button
                              aria-expanded={showDenominationCalculator}
                              className="cash-btn-toggle-calculator"
                              onClick={() => setShowDenominationCalculator((prev) => !prev)}
                              size="sm"
                              type="button"
                              variant="secondary"
                            >
                              <Icon name="cash" />
                              {showDenominationCalculator
                                ? "Digitar valor direto"
                                : "Contar cédulas e moedas"}
                            </Button>
                          </div>

                          {showDenominationCalculator ? (
                            <div className="cash-denomination-calculator">
                              <div className="cash-denomination-calculator__header">
                                <span>Informe a quantidade de cada cédula ou moeda.</span>
                                <Button
                                  onClick={clearDenominations}
                                  size="sm"
                                  type="button"
                                  variant="ghost"
                                >
                                  Zerar contagem
                                </Button>
                              </div>
                              <div className="cash-denomination-grid">
                                {BRL_DENOMINATIONS.map((d) => (
                                  <label className="cash-denomination-item" key={d.cents}>
                                    <span className="cash-denomination-item__label">
                                      <span
                                        className={`cash-denom-type ${d.type === "bill" ? "bill" : "coin"}`}
                                      >
                                        {d.type === "bill" ? "Cédula" : "Moeda"}
                                      </span>
                                      <strong>{d.label}</strong>
                                    </span>
                                    <Input
                                      inputMode="numeric"
                                      min="0"
                                      onChange={(event) =>
                                        updateDenomination(d.cents, event.target.value)
                                      }
                                      placeholder="0"
                                      type="number"
                                      value={
                                        denominationCounts[d.cents]
                                          ? String(denominationCounts[d.cents])
                                          : ""
                                      }
                                    />
                                    <small className="cash-denomination-subtotal">
                                      = {formatMoney((denominationCounts[d.cents] ?? 0) * d.cents)}
                                    </small>
                                  </label>
                                ))}
                              </div>
                              <div className="cash-denomination-total-bar">
                                <span>Total contado</span>
                                <strong>{counted ? `R$ ${counted}` : "R$ 0,00"}</strong>
                              </div>
                            </div>
                          ) : (
                            <div className="cash-counted-field">
                              <label>
                                Dinheiro contado
                                <Input
                                  className="cash-input-lg"
                                  data-currency="brl"
                                  inputMode="decimal"
                                  onChange={(event) => {
                                    setCounted(formatCurrencyInput(event.target.value));
                                    setConfirmClose(false);
                                  }}
                                  placeholder="0,00"
                                  required
                                  value={counted}
                                />
                              </label>
                            </div>
                          )}
                        </div>

                        {closeMethods.filter((method) => method !== "cash").length > 0 && (
                          <div className="cash-closure-step">
                            <div className="cash-closure-step__header">
                              <span className="cash-step-number">2</span>
                              <div>
                                <strong>Outras formas de pagamento</strong>
                                <small>Confira no relatório da maquininha ou no extrato Pix.</small>
                              </div>
                            </div>
                            <div className="cash-tender-grid">
                              {closeMethods
                                .filter((method) => method !== "cash")
                                .map((method) => (
                                  <label key={method}>
                                    {paymentMethodLabel(method)} (R$)
                                    <Input
                                      inputMode="decimal"
                                      onChange={(event) => {
                                        setTenderCounts((current) => ({
                                          ...current,
                                          [method]: formatCurrencyInput(event.target.value),
                                        }));
                                        setConfirmClose(false);
                                      }}
                                      placeholder="0,00"
                                      required
                                      value={tenderCounts[method] ?? ""}
                                    />
                                  </label>
                                ))}
                            </div>
                          </div>
                        )}

                        <div className="cash-closure-step">
                          <div className="cash-closure-step__header">
                            <span className="cash-step-number">
                              {closeMethods.filter((m) => m !== "cash").length > 0 ? "3" : "2"}
                            </span>
                            <div>
                              <strong>Observação (opcional)</strong>
                            </div>
                          </div>
                          <label className="cash-closure-reason-label">
                            Observação do fechamento
                            <Input
                              onChange={(event) => setCloseReason(event.target.value)}
                              placeholder="Ex.: Troco inicial conferido, sangria entregue ao gerente."
                              value={closeReason}
                            />
                          </label>
                        </div>

                        {confirmClose && (
                          <div className="cash-confirm-box" role="alert">
                            <div className="cash-confirm-box__header">
                              <Icon name="alert-circle" />
                              <div>
                                <strong>Confirmar os valores contados?</strong>
                                <p>
                                  Ao confirmar, o turno será encerrado e as diferenças ficarão
                                  registradas.
                                </p>
                              </div>
                            </div>
                            <div className="cash-confirm-box__summary">
                              {closeMethods.map((method) => (
                                <div className="cash-confirm-item" key={method}>
                                  <span className="cash-confirm-item__label">
                                    {paymentMethodLabel(method)}:
                                  </span>
                                  <span className="cash-confirm-item__val">
                                    {formatMoney(
                                      method === "cash"
                                        ? currencyToCents(counted)
                                        : currencyToCents(tenderCounts[method] ?? ""),
                                    )}
                                  </span>
                                </div>
                              ))}
                            </div>
                            <div className="cash-confirm-box__actions">
                              <Button
                                disabled={busy !== null || !online}
                                size="md"
                                type="submit"
                                variant="danger"
                              >
                                {busy === "close" ? "Encerrando turno…" : "Confirmar fechamento"}
                              </Button>
                              <Button
                                disabled={busy !== null}
                                onClick={() => setConfirmClose(false)}
                                size="md"
                                type="button"
                                variant="secondary"
                              >
                                Corrigir valores
                              </Button>
                            </div>
                          </div>
                        )}

                        {!confirmClose && (
                          <div className="cash-closure-actions">
                            <Button
                              disabled={busy !== null || !online}
                              size="md"
                              type="submit"
                              variant="primary"
                            >
                              Revisar contagem
                            </Button>
                            <Button
                              onClick={() => {
                                setActiveActionPanel(null);
                                setConfirmClose(false);
                              }}
                              size="md"
                              type="button"
                              variant="secondary"
                            >
                              Cancelar
                            </Button>
                          </div>
                        )}
                      </form>
                    </div>
                  )}

                  {/* PAINEL DE MOVIMENTAÇÃO FÍSICA (SANGRIA / SUPRIMENTO) */}
                  {data.capabilities.canMove && activeActionPanel === "movement" && (
                    <div>
                      <p className="cash-card-desc">
                        {movementType === "supply"
                          ? "Entrada de dinheiro na gaveta."
                          : "Retirada de dinheiro da gaveta."}
                      </p>
                      <fieldset
                        className="cash-movement-type-toggle"
                        aria-label="Tipo de movimento"
                      >
                        <Button
                          aria-pressed={movementType === "withdrawal"}
                          disabled={busy !== null}
                          onClick={() => setMovementType("withdrawal")}
                          size="sm"
                          type="button"
                          variant={movementType === "withdrawal" ? "primary" : "secondary"}
                        >
                          Sangria (Saída)
                        </Button>
                        <Button
                          aria-pressed={movementType === "supply"}
                          disabled={busy !== null}
                          onClick={() => setMovementType("supply")}
                          size="sm"
                          type="button"
                          variant={movementType === "supply" ? "primary" : "secondary"}
                        >
                          Suprimento (Entrada)
                        </Button>
                      </fieldset>
                      <form
                        className="action-form cash-action-form-grid"
                        onSubmit={(event) => void addMovement(event, open.id)}
                      >
                        <label>
                          Valor (R$)
                          <Input
                            data-currency="brl"
                            inputMode="decimal"
                            onChange={(event) =>
                              setMovementAmount(formatCurrencyInput(event.target.value))
                            }
                            placeholder="0,00"
                            required
                            value={movementAmount}
                          />
                        </label>
                        <label className="action-form__wide">
                          Motivo
                          <Input
                            minLength={3}
                            onChange={(event) => setMovementReason(event.target.value)}
                            placeholder={
                              movementType === "supply"
                                ? "Ex.: Reforço de troco para o turno da noite"
                                : "Ex.: Sangria para o cofre do restaurante"
                            }
                            required
                            value={movementReason}
                          />
                        </label>
                        <div className="cash-form-buttons action-form__wide">
                          <Button disabled={busy !== null || !online} size="md" type="submit">
                            {busy === "movement"
                              ? "Registrando…"
                              : movementType === "supply"
                                ? "Registrar suprimento"
                                : "Registrar sangria"}
                          </Button>
                          <Button
                            disabled={busy !== null}
                            onClick={() => setActiveActionPanel(null)}
                            size="md"
                            type="button"
                            variant="secondary"
                          >
                            Cancelar
                          </Button>
                        </div>
                      </form>
                    </div>
                  )}

                  {/* PAINEL DE TRANSFERÊNCIA ENTRE GAVETAS */}
                  {data.capabilities.canTransfer &&
                    openShifts.length > 1 &&
                    activeActionPanel === "transfer" && (
                      <div>
                        <p className="cash-card-desc">
                          O responsável pelo destino precisa aceitar o valor.
                        </p>
                        <form
                          className="action-form cash-action-form-grid"
                          onSubmit={(event) => void transferCash(event, open.id)}
                        >
                          <label>
                            Gaveta de destino
                            <NativeSelect
                              onChange={(event) => setTransferToShiftId(event.target.value)}
                              required
                              value={transferToShiftId}
                            >
                              <option value="">Selecione a gaveta</option>
                              {openShifts
                                .filter((shift) => shift.id !== open.id)
                                .map((shift) => (
                                  <option key={shift.id} value={shift.id}>
                                    {shift.cashRegisterName}
                                  </option>
                                ))}
                            </NativeSelect>
                          </label>
                          <label>
                            Valor a transferir (R$)
                            <Input
                              data-currency="brl"
                              inputMode="decimal"
                              onChange={(event) =>
                                setTransferAmount(formatCurrencyInput(event.target.value))
                              }
                              placeholder="0,00"
                              required
                              value={transferAmount}
                            />
                          </label>
                          <label className="action-form__wide">
                            Motivo
                            <Input
                              minLength={3}
                              onChange={(event) => setTransferReason(event.target.value)}
                              placeholder="Ex.: Repasse de troco para o bar"
                              required
                              value={transferReason}
                            />
                          </label>
                          <div className="cash-form-buttons action-form__wide">
                            <Button disabled={busy !== null || !online} size="md" type="submit">
                              {busy === "transfer" ? "Transferindo…" : "Solicitar transferência"}
                            </Button>
                            <Button
                              disabled={busy !== null}
                              onClick={() => setActiveActionPanel(null)}
                              size="md"
                              type="button"
                              variant="secondary"
                            >
                              Cancelar
                            </Button>
                          </div>
                        </form>
                      </div>
                    )}
                </Modal>

                {/* EXTRATO DO CAIXA COM FILTROS */}
                <Card className="cash-ledger" hidden={activeView !== "ledger"}>
                  <div className="card-header">
                    <div>
                      <p className="eyebrow">Turno atual</p>
                      <h2>Extrato do caixa</h2>
                    </div>
                    <div className="cash-ledger__header-actions">
                      <fieldset
                        className="cash-ledger__filter-tabs"
                        aria-label="Filtrar lançamentos"
                      >
                        <Button
                          aria-pressed={ledgerFilter === "all"}
                          onClick={() => setLedgerFilter("all")}
                          size="sm"
                          variant={ledgerFilter === "all" ? "secondary" : "ghost"}
                          type="button"
                        >
                          Todos ({entries.length})
                        </Button>
                        <Button
                          aria-pressed={ledgerFilter === "in"}
                          onClick={() => setLedgerFilter("in")}
                          size="sm"
                          variant={ledgerFilter === "in" ? "secondary" : "ghost"}
                          type="button"
                        >
                          Entradas (+{entries.filter((e) => e.direction === "in").length})
                        </Button>
                        <Button
                          aria-pressed={ledgerFilter === "out"}
                          onClick={() => setLedgerFilter("out")}
                          size="sm"
                          variant={ledgerFilter === "out" ? "secondary" : "ghost"}
                          type="button"
                        >
                          Saídas (-{entries.filter((e) => e.direction === "out").length})
                        </Button>
                      </fieldset>
                    </div>
                  </div>

                  {summary.byMethod.size > 0 && (
                    <div className="cash-methods">
                      {[...summary.byMethod].map(([method, amountCents]) => (
                        <span key={method}>
                          <small>{paymentMethodLabel(method)}</small>
                          <strong>{formatMoney(amountCents)}</strong>
                        </span>
                      ))}
                    </div>
                  )}

                  {filteredEntries.length > 0 ? (
                    <div className="cash-entry-list">
                      {filteredEntries.map((entry) => (
                        <div className="cash-entry" key={entry.id}>
                          <span
                            aria-hidden="true"
                            className={`cash-entry-badge ${entry.direction === "in" ? "positive" : "negative"}`}
                          >
                            {entry.direction === "in" ? "↑" : "↓"}
                          </span>
                          <span>
                            <strong>{cashEntryLabel(entry.entryType)}</strong>
                            <small>
                              {entry.description ?? paymentMethodLabel(entry.paymentMethod)} ·{" "}
                              {entry.actorName ?? "Sistema"} · {dateLabel(entry.occurredAt)}
                            </small>
                          </span>
                          <strong
                            className={`cash-entry-val ${entry.direction === "in" ? "positive" : "negative"}`}
                          >
                            {entry.direction === "in" ? "+" : "−"}
                            {formatMoney(entry.amountCents)}
                          </strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      description={
                        ledgerFilter === "all"
                          ? "Vendas, recebimentos, suprimentos e sangrias aparecerão aqui."
                          : "Nenhum lançamento encontrado para o filtro selecionado."
                      }
                      icon="$"
                      title={
                        ledgerFilter === "all"
                          ? "Turno sem lançamentos"
                          : "Nenhum lançamento no filtro"
                      }
                    />
                  )}
                </Card>
              </>
            ) : activeView === "shift" && !selectedRegister ? (
              <Card>
                <EmptyState
                  description={
                    data.capabilities.canManageRegisters
                      ? 'Abra "Gavetas" no topo e adicione a primeira gaveta.'
                      : "Peça ao responsável pela unidade para cadastrar uma gaveta. Depois, selecione-a para consultar o turno."
                  }
                  icon="$"
                  title="Cadastre uma gaveta para começar"
                />
              </Card>
            ) : activeView === "shift" ? (
              /* HERO CARD DE ABERTURA DE CAIXA COM CHIPS RÁPIDOS */
              <Card className="cash-hero-card cash-hero-card--opening">
                <div className="cash-hero-card__header">
                  <div className="cash-hero-card__badge-row">
                    <StatusDot tone="neutral" />
                    <span className="cash-hero-card__status">
                      {selectedRegister?.active ? "Gaveta fechada" : "Gaveta inativa"}
                    </span>
                  </div>
                  <h2 className="cash-hero-card__title">
                    {selectedRegister
                      ? `Abrir caixa — ${selectedRegister.name}`
                      : "Nenhuma gaveta selecionada"}
                  </h2>
                  <p className="cash-hero-card__desc">
                    Informe o dinheiro disponível para troco no início do turno.
                  </p>
                </div>

                {data.capabilities.canOpen && selectedRegister?.active ? (
                  <div className="cash-hero-card__body">
                    <div className="cash-quick-chips-section">
                      <span className="cash-quick-chips-title">Fundo de troco</span>
                      <div className="cash-quick-chips">
                        {QUICK_OPENING_AMOUNTS.map((chip) => (
                          <Button
                            aria-pressed={opening === chip.value}
                            key={chip.value}
                            onClick={() => setOpening(chip.value)}
                            type="button"
                            size="sm"
                            variant={opening === chip.value ? "primary" : "secondary"}
                          >
                            {chip.label}
                          </Button>
                        ))}
                        {opening && !QUICK_OPENING_AMOUNTS.some((c) => c.value === opening) && (
                          <Button
                            onClick={() => setOpening("")}
                            type="button"
                            size="sm"
                            variant="ghost"
                          >
                            Limpar
                          </Button>
                        )}
                      </div>
                    </div>

                    <form
                      className="cash-opening-form"
                      onSubmit={(event) => void openShift(event, selectedRegister.id)}
                    >
                      <div className="cash-opening-form__field">
                        <label>
                          Fundo de troco inicial (R$)
                          <Input
                            className="cash-opening-input"
                            data-currency="brl"
                            inputMode="decimal"
                            onChange={(event) =>
                              setOpening(formatCurrencyInput(event.target.value))
                            }
                            placeholder="0,00"
                            required
                            value={opening}
                          />
                        </label>
                      </div>
                      <Button
                        className="cash-btn-open-shift"
                        disabled={busy !== null || !online}
                        size="md"
                        type="submit"
                      >
                        {busy === "open" ? "Abrindo turno…" : "Abrir turno"}
                      </Button>
                    </form>
                  </div>
                ) : selectedRegister && !data.capabilities.canOpen ? (
                  <p className="cash-hero-card__permission-msg">
                    Seu perfil de acesso pode consultar o histórico de fechamentos, mas não possui
                    permissão para abrir turnos nesta gaveta.
                  </p>
                ) : (
                  <p className="cash-hero-card__permission-msg">
                    Esta gaveta está inativa. Selecione uma gaveta ativa para abrir o turno.
                  </p>
                )}
              </Card>
            ) : activeView === "ledger" ? (
              <Card>
                <EmptyState
                  description="Abra um turno nesta gaveta para acompanhar seus lançamentos."
                  icon="$"
                  title="Nenhum turno aberto"
                />
              </Card>
            ) : null}

            {/* MODAL DE COMPROVANTE OFICIAL DE FECHAMENTO (SLIP TÉRMICO) */}
            {lastClosure && (
              <Modal
                isOpen={showReceiptModal}
                onClose={() => setShowReceiptModal(false)}
                size="md"
                className="cash-modal"
                title="Comprovante de fechamento"
              >
                <CashClosureReceipt
                  shift={{
                    id: lastClosure.cashShiftId,
                    unitName: lastClosure.unitName,
                    cashRegisterName: lastClosure.cashRegisterName,
                    operatorName: lastClosure.operatorName,
                    responsibleName: lastClosure.responsibleName,
                    closedByName: lastClosure.closedByName,
                    openingCents: lastClosure.openingCents,
                    expectedCents: lastClosure.expectedCents,
                    countedCents: lastClosure.countedCents,
                    differenceCents: lastClosure.differenceCents,
                    openedAt: lastClosure.openedAt,
                    closedAt: lastClosure.closedAt,
                  }}
                  breakdown={lastClosure.breakdown}
                />

                <div className="cash-slip-modal-actions">
                  <Button
                    onClick={() => {
                      window.print();
                    }}
                    size="md"
                    type="button"
                    variant="primary"
                  >
                    Imprimir Comprovante
                  </Button>
                  <Button
                    onClick={() => setShowReceiptModal(false)}
                    size="md"
                    type="button"
                    variant="ghost"
                  >
                    Fechar
                  </Button>
                </div>
              </Modal>
            )}

            {/* REVISÃO DE DIVERGÊNCIA */}
            {activeView === "history" && reviewCandidate && data.capabilities.canReview && (
              <details className="action-panel cash-review">
                <summary>
                  <span>
                    <strong>
                      {reviewCandidate.differenceCents
                        ? `Revisar divergência de ${formatMoney(reviewCandidate.differenceCents)}`
                        : "Revisar divergência por forma de pagamento"}
                    </strong>
                    <small>
                      Fechado por {reviewCandidate.closedByName ?? "operador identificado"} em{" "}
                      {dateLabel(reviewCandidate.closedAt)}.
                    </small>
                  </span>
                  <Badge tone="warning">Pendente</Badge>
                </summary>
                <p
                  className="cash-inline-empty"
                  role={reviewRequiresAnotherManager ? "status" : undefined}
                >
                  {reviewRequiresAnotherManager
                    ? "Outro gestor deve revisar este turno, pois você participou da operação."
                    : "A revisão deve ser feita por um gestor que não abriu, assumiu ou fechou este turno."}
                </p>
                {!reviewRequiresAnotherManager && (
                  <form
                    className="action-form"
                    onSubmit={(event) => void reviewShift(event, reviewCandidate.id)}
                  >
                    <label className="action-form__wide">
                      Justificativa da revisão
                      <Input
                        minLength={3}
                        onChange={(event) => setReviewNote(event.target.value)}
                        required
                        value={reviewNote}
                      />
                    </label>
                    <Button disabled={busy !== null || !online} type="submit">
                      {busy === "review" ? "Revisando…" : "Concluir revisão"}
                    </Button>
                  </form>
                )}
              </details>
            )}

            {/* AJUSTES PÓS-FECHAMENTO */}
            {activeView === "history" && data.adjustments.length > 0 && (
              <Card className="cash-adjustments">
                <div className="card-header">
                  <div>
                    <p className="eyebrow">Pós-fechamento</p>
                    <h2>Ajustes e estornos</h2>
                  </div>
                  <Badge tone="warning">{data.adjustments.length}</Badge>
                </div>
                <div className="cash-entry-list">
                  {data.adjustments.map((entry) => (
                    <div className="cash-entry" key={entry.id}>
                      <span aria-hidden="true">{entry.direction === "in" ? "↑" : "↓"}</span>
                      <span>
                        <strong>{cashEntryLabel(entry.entryType)}</strong>
                        <small>
                          {entry.description ?? paymentMethodLabel(entry.paymentMethod)} ·{" "}
                          {entry.actorName ?? "Sistema"} · {dateLabel(entry.occurredAt)}
                        </small>
                      </span>
                      <strong>{formatMoney(entry.amountCents)}</strong>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* PAINÉIS DE ADMINISTRAÇÃO E HISTÓRICO */}
            {(activeView === "shift" || activeView === "settings") && (
              <CashAdministrationPanels
                data={data}
                identityId={identityId}
                key={`${open?.id ?? selectedRegister?.id ?? "no-register"}:${activeView}`}
                onChanged={remote.retry}
                online={online}
                openShift={open}
                scope={scope}
                section={activeView === "shift" ? "operations" : "settings"}
              />
            )}
            {activeView === "history" && <CashHistoryPanel data={data} scope={scope} />}
          </div>
        );
      }}
    </RemoteGate>
  );
}

function isPendingApproval(value: unknown) {
  return (
    typeof value === "object" &&
    value !== null &&
    ("approvalId" in value || ("status" in value && value.status === "pending"))
  );
}
