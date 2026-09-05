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
import { api } from "../../api";
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
import { CashHistoryPanel } from "./CashHistoryPanel";
import { cashEntryLabel, paymentMethodLabel, summarizeCashEntries } from "./cash";
import "./cash.css";

type BusyAction = "open" | "movement" | "close" | "review" | "register" | "transfer" | null;

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

export function RealCashPage({ scope }: { scope: ManagementScope }) {
  const remote = useRemote(scope, api.management.cashShifts, parseCash);
  const online = useOnline();
  const [opening, setOpening] = useState("");
  const [selectedRegisterId, setSelectedRegisterId] = useState("");
  const [registerName, setRegisterName] = useState("");
  const [showRegisterForm, setShowRegisterForm] = useState(false);
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
  const [activeActionPanel, setActiveActionPanel] = useState<
    "close" | "movement" | "transfer" | null
  >("close");
  const [ledgerFilter, setLedgerFilter] = useState<"all" | "in" | "out">("all");

  // Novas funcionalidades reais
  const [pendingTabsExpanded, setPendingTabsExpanded] = useState(false);
  const [showDenominationCalculator, setShowDenominationCalculator] = useState(false);
  const [denominationCounts, setDenominationCounts] = useState<Record<number, number>>({});
  const [showReceiptModal, setShowReceiptModal] = useState(false);

  function selectRegister(cashRegisterId: string) {
    setSelectedRegisterId(cashRegisterId);
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
    setActiveActionPanel("close");
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
      setActiveActionPanel("close");
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
      setActionError(error instanceof Error ? error.message : "Não foi possível revisar o caixa.");
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

        const filteredEntries = entries.filter((entry) => {
          if (ledgerFilter === "in") return entry.direction === "in";
          if (ledgerFilter === "out") return entry.direction === "out";
          return true;
        });

        return (
          <div className="cash-page growth-stack">
            {!online && (
              <p className="cash-notice cash-notice--warning" role="alert">
                Você está offline. A consulta continua visível, mas abertura, lançamentos e
                fechamento estão bloqueados.
              </p>
            )}

            {/* ALERTAS OPERACIONAIS EM DESTAQUE NO TOPO */}
            {data.alerts.length > 0 && (
              <div className="cash-top-alerts">
                {data.alerts.map((alert) => (
                  <Callout
                    key={`${alert.code}:${alert.cashShiftId ?? alert.installationId ?? "unit"}`}
                    tone={alert.severity === "critical" ? "danger" : "warning"}
                  >
                    <div className="cash-top-alert-content">
                      <Icon name="alert-circle" />
                      <div>
                        <strong>
                          {alert.severity === "critical"
                            ? "Alerta Crítico de Caixa"
                            : "Atenção Operacional"}
                        </strong>
                        <p>{alert.message}</p>
                      </div>
                    </div>
                  </Callout>
                ))}
              </div>
            )}

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

            {/* SELETOR DE GAVETAS FÍSICAS */}
            <Card className="cash-registers">
              <div className="card-header">
                <div>
                  <p className="eyebrow">Gavetas físicas</p>
                  <h2>Caixas da unidade</h2>
                </div>
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
                          onClick={() => selectRegister(cashRegister.id)}
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
                              tone={shift ? "success" : cashRegister.active ? "neutral" : "warning"}
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
                          {selected && (
                            <span className="cash-register-card__selected-pill">
                              Gaveta em foco
                            </span>
                          )}
                        </Button>
                        {data.capabilities.canManageRegisters && (
                          <details className="cash-register-menu">
                            <summary aria-label={`Ações da gaveta ${cashRegister.name}`}>⋯</summary>
                            <div className="cash-register-menu__content">
                              <Button
                                onClick={(event) => {
                                  event.currentTarget.closest("details")?.removeAttribute("open");
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
                                disabled={busy !== null || Boolean(shift)}
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
                            </div>
                          </details>
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
            </Card>

            {openShifts.length > 1 && (
              <Card className="metric-card cash-consolidated-card">
                <p>Consolidado da unidade ({openShifts.length} gavetas abertas)</p>
                <strong>
                  {data.capabilities.canViewExpected
                    ? formatMoney(consolidatedExpected)
                    : `${openShifts.length} gavetas em operação`}
                </strong>
                <small>Transferências internas entre gavetas não alteram este total.</small>
              </Card>
            )}

            {open ? (
              <>
                {/* BARRA DE OPERAÇÃO DO TURNO ABERTO COM DESTAQUE PARA FECHAMENTO */}
                <div className="cash-operation-header">
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
                        className={`cash-btn-close-highlight ${
                          activeActionPanel === "close" ? "cash-btn-close-highlight--active" : ""
                        }`}
                        onClick={() => {
                          setActiveActionPanel((curr) => (curr === "close" ? null : "close"));
                          setConfirmClose(false);
                        }}
                        size="md"
                        type="button"
                        variant="danger"
                      >
                        <Icon name="check" />
                        {activeActionPanel === "close" ? "Ocultar fechamento" : "Fechar caixa"}
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
                            setMovementType("withdrawal");
                            setActiveActionPanel((curr) =>
                              curr === "movement" && movementType === "withdrawal"
                                ? null
                                : "movement",
                            );
                          }}
                          size="md"
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
                            setMovementType("supply");
                            setActiveActionPanel((curr) =>
                              curr === "movement" && movementType === "supply" ? null : "movement",
                            );
                          }}
                          size="md"
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
                          setActiveActionPanel((curr) => (curr === "transfer" ? null : "transfer"));
                        }}
                        size="md"
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
                <div className="metrics-grid metrics-grid--three">
                  <Card className="metric-card">
                    <p>{open.cashRegisterName}</p>
                    <strong>
                      {open.responsibleName ?? open.operatorName ?? "Operador identificado"}
                    </strong>
                    <small>Desde {dateLabel(open.openedAt)}</small>
                  </Card>
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
                {data.pendingTabs.length > 0 && (
                  <Callout tone="warning">
                    <div className="cash-pending-banner">
                      <div className="cash-pending-banner__text">
                        <div className="cash-pending-banner__header">
                          <Icon name="alert-circle" />
                          <strong>
                            Atenção antes de fechar: {data.pendingTabs.length} comanda(s) com saldo
                            pendente
                          </strong>
                        </div>
                        <p>
                          Total de {formatMoney(totalPendingTabsCents)} ainda não recebido no salão.
                          Se fechar agora, esses recebimentos não farão parte deste turno.
                        </p>
                      </div>
                      <div className="cash-pending-banner__actions">
                        <Button
                          onClick={() => setPendingTabsExpanded((prev) => !prev)}
                          size="sm"
                          type="button"
                          variant="secondary"
                        >
                          {pendingTabsExpanded
                            ? "Ocultar comandas"
                            : `Ver ${data.pendingTabs.length} comanda(s)`}
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
                {data.capabilities.canClose && activeActionPanel === "close" && (
                  <Card className="cash-action-card cash-closure-card" id="cash-closure-panel">
                    <div className="card-header">
                      <div>
                        <p className="eyebrow">Conferência Cega do Turno</p>
                        <h2>Encerramento e Fechamento de Caixa</h2>
                        <p className="cash-card-desc">
                          Conte os valores físicos da gaveta e os totais das maquininhas de cartão e
                          Pix. O sistema revelará eventuais diferenças e sobras/faltas após a
                          confirmação.
                        </p>
                      </div>
                      <Badge tone="danger">Fechamento Ativo</Badge>
                    </div>

                    <form
                      className="cash-closure-form"
                      onSubmit={(event) => void closeShift(event, open.id, closeMethods)}
                    >
                      <div className="cash-closure-step">
                        <div className="cash-closure-step__header">
                          <span className="cash-step-number">1</span>
                          <div>
                            <strong>Dinheiro em espécie contado na gaveta</strong>
                            <small>
                              Cédulas e moedas físicas contadas na gaveta física neste momento.
                            </small>
                          </div>
                          <Button
                            className="cash-btn-toggle-calculator"
                            onClick={() => setShowDenominationCalculator((prev) => !prev)}
                            size="sm"
                            type="button"
                            variant="secondary"
                          >
                            <Icon name="cash" />
                            {showDenominationCalculator
                              ? "Digitar valor direto"
                              : "Contador de cédulas e moedas"}
                          </Button>
                        </div>

                        {showDenominationCalculator ? (
                          <div className="cash-denomination-calculator">
                            <div className="cash-denomination-calculator__header">
                              <span>
                                <strong>Calculadora física de cédulas e moedas:</strong> Digite as
                                quantidades encontradas na gaveta.
                              </span>
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
                              <span>Total apurado pelas cédulas e moedas:</span>
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
                              <strong>Conferência de outras formas de pagamento</strong>
                              <small>
                                Total conferido no relatório de fechamento das maquininhas (POS) ou
                                extrato Pix.
                              </small>
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
                            <strong>Observações do turno (opcional)</strong>
                            <small>
                              Anotações sobre sobras, faltas ou ocorrências operacionais para
                              auditoria gerencial.
                            </small>
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
                              <strong>Confira os valores antes de encerrar o turno:</strong>
                              <p>Após fechar, o esperado e a diferença serão revelados.</p>
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
                              onClick={() => setConfirmClose(false)}
                              size="md"
                              type="button"
                              variant="secondary"
                            >
                              Corrigir Valores
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
                            variant="danger"
                          >
                            Revisar Contagem e Fechar Caixa
                          </Button>
                          <Button
                            onClick={() => {
                              setActiveActionPanel(null);
                              setConfirmClose(false);
                            }}
                            size="md"
                            type="button"
                            variant="ghost"
                          >
                            Recolher
                          </Button>
                        </div>
                      )}
                    </form>
                  </Card>
                )}

                {/* PAINEL DE MOVIMENTAÇÃO FÍSICA (SANGRIA / SUPRIMENTO) */}
                {data.capabilities.canMove && activeActionPanel === "movement" && (
                  <Card className="cash-action-card cash-movement-card">
                    <div className="card-header">
                      <div>
                        <p className="eyebrow">Movimentação Física</p>
                        <h2>
                          {movementType === "supply"
                            ? "Suprimento de Caixa (Entrada)"
                            : "Sangria de Caixa (Retirada)"}
                        </h2>
                        <p className="cash-card-desc">
                          {movementType === "supply"
                            ? "Aporte de dinheiro físico na gaveta para troco ou reforço operacional."
                            : "Retirada de dinheiro físico da gaveta para cofre, depósito ou pagamentos de despesas."}
                        </p>
                      </div>
                      <div className="cash-movement-type-toggle">
                        <Button
                          onClick={() => setMovementType("withdrawal")}
                          size="sm"
                          type="button"
                          variant={movementType === "withdrawal" ? "primary" : "secondary"}
                        >
                          Sangria (Saída)
                        </Button>
                        <Button
                          onClick={() => setMovementType("supply")}
                          size="sm"
                          type="button"
                          variant={movementType === "supply" ? "primary" : "secondary"}
                        >
                          Suprimento (Entrada)
                        </Button>
                      </div>
                    </div>
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
                        Motivo auditável
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
                              ? "Registrar Suprimento"
                              : "Registrar Sangria"}
                        </Button>
                        <Button
                          onClick={() => setActiveActionPanel(null)}
                          size="md"
                          type="button"
                          variant="ghost"
                        >
                          Cancelar
                        </Button>
                      </div>
                    </form>
                  </Card>
                )}

                {/* PAINEL DE TRANSFERÊNCIA ENTRE GAVETAS */}
                {data.capabilities.canTransfer &&
                  openShifts.length > 1 &&
                  activeActionPanel === "transfer" && (
                    <Card className="cash-action-card cash-transfer-card">
                      <div className="card-header">
                        <div>
                          <p className="eyebrow">Transferência Interna</p>
                          <h2>Transferir Dinheiro entre Gavetas</h2>
                          <p className="cash-card-desc">
                            A saída desta gaveta e a entrada na gaveta de destino são registradas
                            juntas com auditoria.
                          </p>
                        </div>
                        <Badge tone="neutral">Transferência</Badge>
                      </div>
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
                            {busy === "transfer" ? "Transferindo…" : "Transferir Valor"}
                          </Button>
                          <Button
                            onClick={() => setActiveActionPanel(null)}
                            size="md"
                            type="button"
                            variant="ghost"
                          >
                            Cancelar
                          </Button>
                        </div>
                      </form>
                    </Card>
                  )}

                {/* EXTRATO DO CAIXA COM FILTROS */}
                <Card className="cash-ledger">
                  <div className="card-header">
                    <div>
                      <p className="eyebrow">Turno atual</p>
                      <h2>Extrato do caixa</h2>
                    </div>
                    <div className="cash-ledger__header-actions">
                      <div className="cash-ledger__filter-tabs" role="tablist">
                        <button
                          aria-selected={ledgerFilter === "all"}
                          className={`cash-tab-btn ${ledgerFilter === "all" ? "cash-tab-btn--active" : ""}`}
                          onClick={() => setLedgerFilter("all")}
                          role="tab"
                          type="button"
                        >
                          Todos ({entries.length})
                        </button>
                        <button
                          aria-selected={ledgerFilter === "in"}
                          className={`cash-tab-btn ${ledgerFilter === "in" ? "cash-tab-btn--active" : ""}`}
                          onClick={() => setLedgerFilter("in")}
                          role="tab"
                          type="button"
                        >
                          Entradas (+{entries.filter((e) => e.direction === "in").length})
                        </button>
                        <button
                          aria-selected={ledgerFilter === "out"}
                          className={`cash-tab-btn ${ledgerFilter === "out" ? "cash-tab-btn--active" : ""}`}
                          onClick={() => setLedgerFilter("out")}
                          role="tab"
                          type="button"
                        >
                          Saídas (-{entries.filter((e) => e.direction === "out").length})
                        </button>
                      </div>
                      <Badge tone="neutral">{entries.length} lançamento(s)</Badge>
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
            ) : (
              /* HERO CARD DE ABERTURA DE CAIXA COM CHIPS RÁPIDOS */
              <Card className="cash-hero-card cash-hero-card--opening">
                <div className="cash-hero-card__header">
                  <div className="cash-hero-card__badge-row">
                    <StatusDot tone="neutral" />
                    <span className="cash-hero-card__status">Gaveta Fechada</span>
                    <Badge tone="neutral">Disponível para Abertura</Badge>
                  </div>
                  <h2 className="cash-hero-card__title">
                    {selectedRegister
                      ? `Abertura de Caixa — ${selectedRegister.name}`
                      : "Nenhuma gaveta selecionada"}
                  </h2>
                  <p className="cash-hero-card__desc">
                    Defina o fundo de troco inicial em dinheiro para liberar esta gaveta física para
                    vendas e recebimentos.
                  </p>
                </div>

                {data.capabilities.canOpen && selectedRegister?.active ? (
                  <div className="cash-hero-card__body">
                    <div className="cash-quick-chips-section">
                      <span className="cash-quick-chips-title">
                        Sugestões de fundo de troco inicial:
                      </span>
                      <div className="cash-quick-chips">
                        {QUICK_OPENING_AMOUNTS.map((chip) => (
                          <button
                            className={`cash-quick-chip ${
                              opening === chip.value ? "cash-quick-chip--active" : ""
                            }`}
                            key={chip.value}
                            onClick={() => setOpening(chip.value)}
                            type="button"
                          >
                            {chip.label}
                          </button>
                        ))}
                        {opening && !QUICK_OPENING_AMOUNTS.some((c) => c.value === opening) && (
                          <button
                            className="cash-quick-chip cash-quick-chip--clear"
                            onClick={() => setOpening("")}
                            type="button"
                          >
                            Limpar
                          </button>
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
                        {busy === "open" ? "Abrindo turno…" : "🔓 Abrir Turno de Caixa"}
                      </Button>
                    </form>
                    <div className="cash-opening-note">
                      <small>
                        Auditoria de ponto de venda ativa. O valor inicial será associado ao seu
                        operador e a conferência cega permanecerá ativa durante todo o turno.
                      </small>
                    </div>
                  </div>
                ) : (
                  <p className="cash-hero-card__permission-msg">
                    Seu perfil de acesso pode consultar o histórico de fechamentos, mas não possui
                    permissão para abrir turnos nesta gaveta.
                  </p>
                )}
              </Card>
            )}

            {/* RESULTADO DO ÚLTIMO FECHAMENTO COM BOTÃO DE IMPRESSÃO */}
            {lastClosure && (
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

            {/* MODAL DE COMPROVANTE OFICIAL DE FECHAMENTO (SLIP TÉRMICO) */}
            {lastClosure && (
              <Modal
                isOpen={showReceiptModal}
                onClose={() => setShowReceiptModal(false)}
                size="md"
                title="Comprovante de Fechamento de Caixa"
              >
                <div className="cash-slip-receipt" id="cash-closure-slip">
                  <div className="cash-slip-receipt__header">
                    <h3>GiroMesa Bistrô</h3>
                    <p>Relatório de Encerramento de Turno</p>
                    <small>Emissão: {dateLabel(new Date().toISOString())}</small>
                  </div>

                  <div className="cash-slip-receipt__section">
                    <p>
                      <strong>Gaveta:</strong> {selectedRegister?.name ?? "Gaveta Física"}
                    </p>
                    <p>
                      <strong>Operador:</strong>{" "}
                      {open?.responsibleName ?? open?.operatorName ?? "Operador identificado"}
                    </p>
                    {open?.openedAt && (
                      <p>
                        <strong>Abertura:</strong> {dateLabel(open.openedAt)}
                      </p>
                    )}
                    <p>
                      <strong>Encerramento:</strong> {dateLabel(new Date().toISOString())}
                    </p>
                  </div>

                  <div className="cash-slip-receipt__divider" />

                  <div className="cash-slip-receipt__values">
                    <div className="cash-slip-row">
                      <span>Fundo Inicial:</span>
                      <strong>{open ? formatMoney(open.openingCents) : "—"}</strong>
                    </div>
                    <div className="cash-slip-row">
                      <span>Total Contado:</span>
                      <strong>{formatMoney(lastClosure.countedCents)}</strong>
                    </div>
                    <div className="cash-slip-row">
                      <span>Total Esperado:</span>
                      <strong>{formatMoney(lastClosure.expectedCents)}</strong>
                    </div>
                    <div className="cash-slip-row cash-slip-row--highlight">
                      <span>Diferença Apurada:</span>
                      <strong>{formatMoney(lastClosure.differenceCents)}</strong>
                    </div>
                  </div>

                  {lastClosure.breakdown.length > 0 && (
                    <>
                      <div className="cash-slip-receipt__divider" />
                      <div className="cash-slip-receipt__section">
                        <strong>Lançamentos por Forma de Pagamento:</strong>
                        {lastClosure.breakdown.map((item) => (
                          <div className="cash-slip-row" key={item.method}>
                            <span>{paymentMethodLabel(item.method)}:</span>
                            <strong>{formatMoney(item.amountCents)}</strong>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  <div className="cash-slip-receipt__divider" />

                  <div className="cash-slip-receipt__signatures">
                    <div className="cash-slip-sign-line">
                      <span>Assinatura do Operador de Caixa</span>
                    </div>
                    <div className="cash-slip-sign-line">
                      <span>Assinatura do Gerente Responsável</span>
                    </div>
                  </div>
                </div>

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
            {reviewCandidate && data.capabilities.canReview && (
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
              </details>
            )}

            {/* AJUSTES PÓS-FECHAMENTO */}
            {data.adjustments.length > 0 && (
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
            <CashAdministrationPanels
              data={data}
              key={open?.id ?? selectedRegister?.id ?? "no-register"}
              onChanged={remote.retry}
              online={online}
              openShift={open}
              scope={scope}
            />
            <CashHistoryPanel data={data} scope={scope} />
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
