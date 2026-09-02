// biome-ignore-all lint/a11y/noLabelWithoutControl: shadcn-compatible controls render native form elements nested by these labels
import { Badge, Button, Card, EmptyState, Input, NativeSelect } from "@giromesa/ui";
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
      setFeedback("Caixa aberto.");
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
      setFeedback("Caixa fechado. Confira o resultado abaixo.");
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

        return (
          <div className="cash-page growth-stack">
            {!online && (
              <p className="cash-notice cash-notice--warning" role="alert">
                Você está offline. A consulta continua visível, mas abertura, lançamentos e
                fechamento estão bloqueados.
              </p>
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
                      autoFocus
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
                            <strong>{cashRegister.name}</strong>
                            <Badge
                              tone={shift ? "success" : cashRegister.active ? "neutral" : "warning"}
                            >
                              {shift ? "Aberto" : cashRegister.active ? "Fechado" : "Inativo"}
                            </Badge>
                          </span>
                          <small>
                            {shift
                              ? `Responsável: ${
                                  shift.responsibleName ?? shift.operatorName ?? "não informado"
                                }`
                              : cashRegister.active
                                ? "Disponível para abertura"
                                : "Fora de uso"}
                          </small>
                          {shift?.openedAt && <small>Desde {dateLabel(shift.openedAt)}</small>}
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
                                autoFocus
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
              <Card className="metric-card">
                <p>Consolidado da unidade</p>
                <strong>
                  {data.capabilities.canViewExpected
                    ? formatMoney(consolidatedExpected)
                    : `${openShifts.length} gavetas em operação`}
                </strong>
                <small>Transferências internas não alteram este total.</small>
              </Card>
            )}

            {open ? (
              <>
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

                {data.pendingTabs.length > 0 && (
                  <Card className="cash-pending">
                    <div>
                      <Badge tone="warning">Antes de fechar</Badge>
                      <strong>{data.pendingTabs.length} comanda(s) com saldo pendente</strong>
                      <small>
                        {formatMoney(
                          data.pendingTabs.reduce((sum, tab) => sum + tab.remainingCents, 0),
                        )}{" "}
                        ainda não recebido
                      </small>
                    </div>
                    <a className="cash-link" href="#/counter">
                      Ir para balcão
                    </a>
                  </Card>
                )}

                <div className="quick-actions-grid">
                  {data.capabilities.canMove && (
                    <details className="action-panel">
                      <summary>
                        <span>
                          <strong>Suprimento ou sangria</strong>
                          <small>Registre a movimentação física com motivo auditável.</small>
                        </span>
                        <span aria-hidden="true">+</span>
                      </summary>
                      <form
                        className="action-form"
                        onSubmit={(event) => void addMovement(event, open.id)}
                      >
                        <label>
                          Tipo
                          <NativeSelect
                            onChange={(event) =>
                              setMovementType(event.target.value as "supply" | "withdrawal")
                            }
                            value={movementType}
                          >
                            <option value="withdrawal">Sangria</option>
                            <option value="supply">Suprimento</option>
                          </NativeSelect>
                        </label>
                        <label>
                          Valor
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
                            required
                            value={movementReason}
                          />
                        </label>
                        <Button disabled={busy !== null || !online} type="submit">
                          {busy === "movement" ? "Registrando…" : "Registrar movimento"}
                        </Button>
                      </form>
                    </details>
                  )}

                  {data.capabilities.canTransfer && openShifts.length > 1 && (
                    <details className="action-panel">
                      <summary>
                        <span>
                          <strong>Transferir entre gavetas</strong>
                          <small>A saída e a entrada são registradas juntas.</small>
                        </span>
                        <span aria-hidden="true">+</span>
                      </summary>
                      <form
                        className="action-form"
                        onSubmit={(event) => void transferCash(event, open.id)}
                      >
                        <label>
                          Destino
                          <NativeSelect
                            onChange={(event) => setTransferToShiftId(event.target.value)}
                            required
                            value={transferToShiftId}
                          >
                            <option value="">Selecione</option>
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
                          Valor
                          <Input
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
                            required
                            value={transferReason}
                          />
                        </label>
                        <Button disabled={busy !== null || !online} type="submit">
                          {busy === "transfer" ? "Transferindo…" : "Transferir valor"}
                        </Button>
                      </form>
                    </details>
                  )}

                  {data.capabilities.canClose && (
                    <details className="action-panel action-panel--danger">
                      <summary>
                        <span>
                          <strong>Fechar caixa</strong>
                          <small>Conte a gaveta sem consultar o valor esperado.</small>
                        </span>
                        <span aria-hidden="true">+</span>
                      </summary>
                      <form
                        className="action-form"
                        onSubmit={(event) => void closeShift(event, open.id, closeMethods)}
                      >
                        <label>
                          Dinheiro contado
                          <Input
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
                        {closeMethods
                          .filter((method) => method !== "cash")
                          .map((method) => (
                            <label key={method}>
                              {paymentMethodLabel(method)} conferido
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
                        <label>
                          Observação
                          <Input
                            onChange={(event) => setCloseReason(event.target.value)}
                            value={closeReason}
                          />
                        </label>
                        {confirmClose && (
                          <div className="cash-confirm action-form__wide" role="alert">
                            <strong>Confirma os valores conferidos?</strong>
                            <span>
                              {closeMethods
                                .map(
                                  (method) =>
                                    `${paymentMethodLabel(method)}: ${formatMoney(
                                      method === "cash"
                                        ? currencyToCents(counted)
                                        : currencyToCents(tenderCounts[method] ?? ""),
                                    )}`,
                                )
                                .join(" · ")}
                            </span>
                            <small>Após fechar, o esperado e a diferença serão revelados.</small>
                            <Button
                              onClick={() => setConfirmClose(false)}
                              type="button"
                              variant="secondary"
                            >
                              Corrigir contagem
                            </Button>
                          </div>
                        )}
                        <Button disabled={busy !== null || !online} type="submit" variant="danger">
                          {busy === "close"
                            ? "Fechando…"
                            : confirmClose
                              ? "Confirmar fechamento"
                              : "Revisar contagem"}
                        </Button>
                      </form>
                    </details>
                  )}
                </div>

                <Card className="cash-ledger">
                  <div className="card-header">
                    <div>
                      <p className="eyebrow">Turno atual</p>
                      <h2>Extrato do caixa</h2>
                    </div>
                    <Badge tone="neutral">{entries.length} lançamento(s)</Badge>
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
                  {entries.length > 0 ? (
                    <div className="cash-entry-list">
                      {entries.map((entry) => (
                        <div className="cash-entry" key={entry.id}>
                          <span
                            aria-hidden="true"
                            className={entry.direction === "in" ? "positive" : "negative"}
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
                          <strong className={entry.direction === "in" ? "positive" : "negative"}>
                            {entry.direction === "in" ? "+" : "−"}
                            {formatMoney(entry.amountCents)}
                          </strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      description="Vendas, recebimentos, suprimentos e sangrias aparecerão aqui."
                      icon="$"
                      title="Turno sem lançamentos"
                    />
                  )}
                </Card>
              </>
            ) : (
              <Card className="remote-state cash-open-card">
                <strong>
                  {selectedRegister
                    ? `${selectedRegister.name} está fechado`
                    : "Nenhuma gaveta disponível"}
                </strong>
                <p>Informe o fundo inicial para abrir esta gaveta.</p>
                {data.capabilities.canOpen && selectedRegister?.active ? (
                  <form
                    className="inline-action-form"
                    onSubmit={(event) => void openShift(event, selectedRegister.id)}
                  >
                    <label>
                      Fundo de caixa (R$)
                      <Input
                        inputMode="decimal"
                        onChange={(event) => setOpening(formatCurrencyInput(event.target.value))}
                        placeholder="0,00"
                        required
                        value={opening}
                      />
                    </label>
                    <Button disabled={busy !== null || !online} type="submit">
                      {busy === "open" ? "Abrindo…" : "Abrir caixa"}
                    </Button>
                  </form>
                ) : (
                  <p>Seu perfil pode consultar o histórico, mas não abrir um turno.</p>
                )}
              </Card>
            )}

            {lastClosure && (
              <Card className="cash-result" aria-live="polite">
                <div className="card-header">
                  <div>
                    <p className="eyebrow">Fechamento concluído</p>
                    <h2>Resultado da conferência</h2>
                  </div>
                  <Badge tone={lastClosure.reviewRequired ? "warning" : "success"}>
                    {lastClosure.reviewRequired ? "Revisão necessária" : "Sem diferença"}
                  </Badge>
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

            <CashAdministrationPanels
              key={open?.id ?? selectedRegister?.id ?? "no-register"}
              data={data}
              online={online}
              onChanged={remote.retry}
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
